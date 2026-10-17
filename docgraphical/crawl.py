# -*- coding: utf-8 -*-
"""Emperor's vine crawl (mode 4): DFS over files with an LLM at every node.

Flow (holy spec, 5 steps):
1. Read the repo CATALOG, LLM picks start nodes -> Node STACK (LIFO).
2. Per FILE node: LLM reads content (+ CPU AST: headings/brackets/links +
   graph neighbors as options) -> related concepts (STAGED hyperlink + tag)
   -> LLM judges next nodes into the stack. CONCEPT nodes expand via CPU
   edges (they have no prose to read). Blacklisted terms never stage.
3. LIFO until the stack is empty; entered/walked ids never re-enter.
4. End: ONE LLM call judges all staged + recommends ONE tag title; the
   human edits it, confirms -> candidate pool.
5. On promote (candidate -> official): kept staged rows materialize as
   physical [mention](tags/Title.md) links + per-heading `> 🏷️ 標籤：`
   node-tag lines (THE standard: tags ride with their nodes, inline links
   in body). The legacy ## 關聯概念 section is banned: apply strips its
   lines for the promoted title.

Cost discipline (cheaper than LLM-Wiki: CPU enumerates, LLM only
multiple-choices): 1 (starts) + 1 per FILE node (cap 10) + 1 (finale).
Staged rows live in the repo db (staged_items/staged_runs); the DFS stack
lives in memory per run_id (a server restart orphans the stack, staged
rows survive and stay queryable).
"""
import os
import re
import sqlite3
import time
import uuid

from .db import get_db_path
from .ingest import FnLinkifyConcepts
from .vine import FnVineGuide, FnResolveSeed, FnVineNeighbors

_RUNS = {}
MAX_FILES_PER_RUN = 10
MAX_STARTS = 3
MAX_PUSH = 5
CONTENT_CAP = 5000
# Hang forensics: zero-behavior timing trace. If a next-step ever wedges
# again, this file names the exact stage (prep/guide/parse/commit).
# (Server stdout on 5003 goes to DEVNULL, so use a fixed file.)
_CRAWL_TRACE = (r"C:\Users\A1081\AppData\Local\Temp\opencode\crawl_trace.log")


def _trace(msg):
    try:
        with open(_CRAWL_TRACE, "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (time.strftime("%H:%M:%S"), msg))
    except Exception:
        pass
# Batch judging: up to N file nodes share ONE LLM call per next-step.
# Cost was 1 + files + 1 (~96s worst case at max_files=10); now
# ceil(files/BATCH_FILE_NEXT) + 2. Human still sees per-file progress
# because the response lists every file section.
BATCH_FILE_NEXT = 5


def _txt(x):
    """None-safe str (module tiny helper, used by all parsers)."""
    try:
        return str(x if x is not None else "")
    except Exception:
        return ""


def FnEnsureStagedTables(db_path):
    con = sqlite3.connect(db_path)
    try:
        con.execute(
            "CREATE TABLE IF NOT EXISTS staged_runs"
            "(run_id TEXT PRIMARY KEY, repo TEXT, title TEXT, status TEXT,"
            " created_at TEXT)")
        con.execute(
            "CREATE TABLE IF NOT EXISTS staged_items"
            "(run_id TEXT, repo TEXT, file TEXT, mention TEXT, concept TEXT,"
            " kind TEXT, status TEXT, created_at TEXT)")
        try:
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_staged_run"
                " ON staged_items(run_id, status)")
        except Exception:
            pass
        con.commit()
    finally:
        con.close()


_NOISE = {"空", "無", "无", "NONE", "None", "none", "nothing", "無路", "不走"}


def _is_noise(name):
    return not name or name.strip() in _NOISE


def _clean_name(s, cap=60):
    """Strip markdown/list markers at the EDGES only.

    Interior underscores and dots are significant (crawl_a.md must
    survive); only bullets, numbering and wrapping emphasis go.
    """
    s = re.sub(r"^(\d+[.\)]|[•\-*#>])+\s*", "", _txt(s)).strip()
    s = re.sub(r"^[*_\"'“”‘’#\[\]]+|[*_\"'“”‘’#\[\]]+$", "", s).strip()
    # "nothing" sentinels the LLM uses to mean no candidate.
    if _is_noise(s):
        return ""
    return s[:cap]


def _parse_lines(text):
    """Parse `走/念/入/留/去/題：name｜由/理由：why` lines + JSON fallback."""
    out = []
    for ln in _txt(text).split("\n"):
        # LLM loves numbering/bolding picks ("1. 走：…", "- **走：…**"):
        # peel list markers BEFORE anchoring on the verb.
        t = re.sub(r"^\s*(?:\d+[.\)]|[-*•>])+\s*", "", ln)
        t = re.sub(r"^\*+\s*", "", t)
        m = (re.match(r"\s*[走念入留去题題][:：]\s*(.+?)\s*[｜|]\s*(?:理由|由)[:：]\s*(.+?)\s*$", t)
             or re.match(r"\s*[走念入留去题題][:：]\s*(.+)", t))
        if not m:
            continue
        verb = t.strip()[0]
        name = _clean_name(m.group(1))
        why = ""
        try:
            why = _clean_name(m.group(2), 40)
        except IndexError:
            why = ""
        if not name or re.search(r"無路|不走", name):
            continue
        if not any(x[1] == name for x in out):
            out.append((verb, name, why))
    if not out:
        try:
            mm = re.search(r"\[[\s\S]*\]", _txt(text))
            arr = __import__("json").loads(mm.group(0)) if mm else []
            for x in arr or []:
                n = str((x or {}).get("target") or (x or {}).get("name") or "").strip()[:60]
                if n and not any(y[1] == n for y in out):
                    out.append(("走", n, str((x or {}).get("why") or "")[:40]))
        except Exception:
            pass
    return out


def _rejected(db_path):
    try:
        con = sqlite3.connect(db_path)
        try:
            return {r[0] for r in con.execute("SELECT term FROM rejected_terms")}
        finally:
            con.close()
    except Exception:
        return set()


def _catalog_file(db_path, repo):
    """Find the repo catalog md (name contains CATALOG), read from disk."""
    try:
        con = sqlite3.connect(db_path)
        try:
            rows = con.execute(
                "SELECT id FROM nodes WHERE id LIKE 'file::%'"
                " AND id LIKE '%catalog%.md'").fetchall()
        finally:
            con.close()
    except Exception:
        rows = []
    for (fid,) in rows:
        rel = fid[len("file::"):]
        abs_p = os.path.join(os.path.realpath(repo), rel)
        if os.path.isfile(abs_p):
            return rel, abs_p
    return "", ""


def _norm_target(db_path, target, repo=""):
    """Normalize an LLM-picked next node to walkable id(s).

    Plain filenames straight from the catalog are taken literally
    (LLM picks those most often); everything else goes fuzzy.
    """
    t = (target or "").strip()
    if not t:
        return []
    if t.startswith("file::"):
        return [{"kind": "file", "id": t[len("file::"):]}]
    if repo:
        root = os.path.realpath(repo)
        cand = os.path.join(root, t)
        if os.path.isfile(cand):
            return [{"kind": "file",
                     "id": os.path.relpath(cand, root).replace("\\", "/")}]
        base = os.path.basename(t)
        if base and base != t:
            cand2 = os.path.join(root, base)
            if os.path.isfile(cand2):
                return [{"kind": "file",
                         "id": os.path.relpath(cand2, root).replace("\\", "/")}]
    try:
        rs = FnResolveSeed(db_path, t)
    except Exception:
        return []
    return rs.get("starts") or []


def _node_id(kind, ident):
    # Canonical stack key: separators unified (Windows joins with \,
    # relpath with / - without this the same file walks twice).
    if kind == "file":
        ident = (ident or "").replace("\\", "/").strip()
    return ("file::" + ident) if kind == "file" else ident


def FnCrawlStart(repo, seed_text="", max_starts=MAX_STARTS, lang="zh"):
    """Step 1: user seed -> literal + LLM semantic footholds -> LIFO stack.

    1 LLM call. No seed, no crawl: without the user's text the stack
    would eat the whole library.
    """
    from .db import get_db_path as _p
    seed = (seed_text or "").strip()[:200]
    if not seed:
        return {"ok": False, "error": "seed required: type what you seek"}
    db_path = _p(repo)
    if not db_path or not os.path.isfile(db_path):
        return {"ok": False, "error": "repo not indexed: %s" % repo}
    FnEnsureStagedTables(db_path)
    # Piggyback GC (mirrors the ingest 24h sweep): dead runs and old
    # rejects go quietly on every start; the dialog shows the count.
    try:
        swept = FnSweepStaged(repo)
    except Exception:
        swept = {"ok": False, "swept_staged": 0, "swept_dropped": 0, "swept_orphan": 0}
    rel, abs_p = _catalog_file(db_path, repo)
    if not abs_p:
        return {"ok": False, "error": "no CATALOG md in %s" % repo}
    try:
        with open(abs_p, "r", encoding="utf-8") as f:
            catalog_text = f.read(CONTENT_CAP)
    except Exception as e:
        return {"ok": False, "error": "cannot read catalog: %s" % e}
    # Literal footholds (free): exact concept / substring / file hits.
    try:
        _rs = FnResolveSeed(db_path, seed)
        lit = (_rs.get("starts") or []) if _rs.get("ok") else []
    except Exception:
        lit = []
    lit_lines = "\n".join(
        "- %s %s" % ("檔" if s.get("kind") == "file" else "概念", s.get("id"))
        for s in lit[:6]) or "無"
    try:
        con = sqlite3.connect(db_path)
        try:
            off = [r[0] for r in con.execute(
                "SELECT name FROM concepts WHERE status = 'official' LIMIT 40")]
            cnd = [r[0] for r in con.execute(
                "SELECT name FROM concepts WHERE status = 'candidate' LIMIT 40")]
        finally:
            con.close()
    except Exception:
        off, cnd = [], []
    # Pick reasons follow the UI language (machine verbs stay zh for the
    # parser); otherwise EN mode shows 直接命中目標 and the emperor rages.
    reason_rule = "理由用繁體中文八字內" if lang != "en" else "reason IN ENGLISH, 8 words max"
    res = FnVineGuide([
        {"role": "system", "content": "你是知識庫的帶路人。用繁體中文思考。"},
        {"role": "user", "content":
         "使用者想找：%s\n字面落點（免費解析，可留可棄）：\n%s\n"
         "總綱內文：\n%s\n收過的：%s\n還在等的：%s\n\n"
         "只看上面，選最值得先摸的起點（呼應使用者想找的；種子寫概念名或檔名都行）。"
         "每行一條，格式 `走：XXX｜理由：Y`，理由%s，最多 %d 行，不要解釋其他話。"
          % (seed, lit_lines, catalog_text, "、".join(off) or "無",
             "、".join(cnd) or "無", reason_rule,
             max(1, min(5, max_starts or MAX_STARTS)))},
    ], max_tokens=400)
    if not res.get("ok"):
        return {"ok": False, "error": res.get("error") or "guide failed"}
    picks = _parse_lines(res.get("text") or "")[:max(1, min(5, max_starts or MAX_STARTS))]
    if not picks:
        return {"ok": False, "error": "guide picked nothing",
                "guide_text": res.get("text") or ""}
    starts = []
    for _verb, name, why in picks:
        for st in _norm_target(db_path, name, repo)[:2]:
            starts.append({"seed": name, "why": why, "kind": st["kind"], "id": st["id"]})
    if not starts:
        return {"ok": False, "error": "picks resolve to nothing",
                "guide_text": res.get("text") or ""}
    # LIFO: reverse so the first pick pops first. Dedup by nid while
    # building: fuzzy file-text-hit can return a file another pick also
    # resolves to (the catalog lists everything - it is a dup magnet), and
    # a set-seen cannot stop a LIST holding the same nid twice.
    run_id = uuid.uuid4().hex[:12]
    stack, seen = [], set()
    for s in reversed(starts):
        nid = _node_id(s["kind"], s["id"])
        if nid in seen:
            continue
        seen.add(nid)
        stack.append(s)
    _RUNS[run_id] = {"repo": repo, "db": db_path, "seed": seed, "stack": stack,
                     "seen": seen, "files_done": 0, "spent": 1, "picks": picks,
                     "model": res.get("model") or "", "trace": []}
    return {"ok": True, "run_id": run_id, "repo": repo, "seed": seed,
            "catalog": rel, "swept": swept,
            "picks": [{"name": n, "why": w} for _v, n, w in picks],
            "model": res.get("model") or ""}


def _ast_of(file_abs):
    """CPU AST surface: headings, [[brackets]], md links. Zero LLM."""
    try:
        with open(file_abs, "r", encoding="utf-8") as f:
            text = f.read(CONTENT_CAP)
    except Exception:
        return "", [], [], []
    heads = re.findall(r"(?m)^#{1,4}\s+(.+?)\s*$", text)[:15]
    brackets = []
    for b in re.findall(r"\[\[([^\[\]]{1,30})\]\]", text):
        if b not in brackets:
            brackets.append(b)
        if len(brackets) >= 15:
            break
    links = []
    for t in re.findall(r"\[([^\]]{1,40})\]\(([^)]+)\)", text):
        links.append(t[0])
        if len(links) >= 10:
            break
    return text, heads, brackets, links


def _process_concept_node(run, db_path, ident):
    """Expand a CONCEPT node via CPU graph edges (no prose to read, free).
    Pushes unvisited file/concept neighbours. Mutates run stack/seen."""
    pushed = []
    try:
        nb = FnVineNeighbors(db_path, ident)
    except Exception:
        nb = {}
    cands = []
    for f in (nb.get("files") or [])[:5]:
        if f.get("path"):
            cands.append({"kind": "file", "id": f["path"]})
    for c in (nb.get("concepts") or [])[:5]:
        if c.get("name"):
            cands.append({"kind": "concept", "id": c["name"]})
    for c in cands:
        nid = _node_id(c["kind"], c["id"])
        if nid not in run["seen"]:
            run["seen"].add(nid)
            run["stack"].append(c)
            pushed.append(nid)
    run["trace"].append("標籤 %s：CPU 按邊展開，推入 %d" % (ident, len(pushed)))
    return {"ok": True, "done": False, "node": ident, "kind": "concept",
            "cpu": True, "pushed": pushed, "spent": run["spent"],
            "stack_left": len(run["stack"])}


def _prep_file_block(db_path, repo, ident):
    """CPU prep for ONE file: content + AST surface + graph neighbors.
    Returns dict {ident, text, heads, brackets, links, opt_lines}."""
    file_abs = os.path.join(os.path.realpath(repo), ident)
    text, heads, brackets, links = _ast_of(file_abs)
    try:
        nb = FnVineNeighbors(db_path, ident)
    except Exception:
        nb = {}
    opt_lines = []
    for c in (nb.get("concepts") or [])[:10]:
        if c.get("name"):
            opt_lines.append("- 概念 %s（%s，經%s）" % (
                c["name"], c.get("status") or "?", c.get("via") or "?"))
    for f in (nb.get("files") or [])[:5]:
        if f.get("path"):
            opt_lines.append("- 檔 %s：%s" % (f["path"], (f.get("snippet") or "")[:60]))
    for h in (nb.get("headings") or [])[:5]:
        if h.get("name"):
            opt_lines.append("- 段 %s（只路過不給入）：%s" % (
                h["name"], (h.get("snippet") or "")[:60]))
    return {"ident": ident, "text": text, "heads": heads,
            "brackets": brackets, "links": links, "opt_lines": opt_lines}


def _process_file_nodes(run, run_id, db_path, repo, idents):
    """Process a BATCH of file nodes: ONE LLM call, per-file sections.

    Prompt lists every file under `@檔：path`; the reply must mirror the
    same markers so _split_batch_reply can attribute 念/入 lines to the
    right file. Verbatim gate + blacklist still apply per file.
    Returns {ok, done, batch: [...], spent, stack_left}.
    """
    rej = _rejected(db_path)
    _trace("next %s rejected_ok" % ((run_id or "")[:8],))
    _t0 = time.time()
    blocks = [_prep_file_block(db_path, repo, ident) for ident in idents]
    _trace("next %s prep %.1fs files=%d" % (run_id[:8], time.time() - _t0, len(blocks)))
    # Latency discipline: a 5-file batch at 4000 chars/file is ~25KB and
    # stews 1-3 min per call while the UI sits mute. Solo file keeps full
    # 4000; batched files drop to 2500 (headings + head carry the signal).
    per_file_cap = 4000 if len(blocks) <= 1 else 2500
    # One prompt, many files. Each file section is self-contained so the
    # model can answer 念/入 under the matching @檔 marker without mixing.
    parts = ["使用者在找：%s\n下面 %d 個檔一起判。只念與該檔內文相關的概念、"
             "只入與使用者想找的相關的下批；無關的念空入空。"
             "任務一：每檔的相關概念，必須是該檔內文原字原句"
             "（照抄，不准改字、不准縮寫、不是原句不念），"
             "每行 `念：原句｜由：八字`，可多行。"
             "任務二：下批入 stack（整輪合併，不重複），"
             "每行 `入：XXX`（檔寫路徑、概念寫名），每檔最多 %d 行。"
             "黑名單詞不要念。只要行，不要解釋。\n"
             % (run.get("seed") or "", len(blocks), MAX_PUSH)]
    for b in blocks:
        parts.append("\n@檔：%s\n內文：\n%s\n\nAST——段：%s\n框：%s\n站內連結：%s\n圖上鄰居：\n%s\n"
                     % (b["ident"], (b["text"] or "")[:per_file_cap],
                        "、".join(b["heads"]) or "無", "、".join(b["brackets"]) or "無",
                        "、".join(b["links"]) or "無", "\n".join(b["opt_lines"]) or "無"))
    _t1 = time.time()
    res = FnVineGuide([
        {"role": "system", "content": "你是知識庫的摸瓜人。用繁體中文。段只路過，不給入 stack。無關就念空入空，不要硬湊。逐檔回答，每檔用 @檔： 起頭。"},
        {"role": "user", "content": "\n".join(parts)},
    ], max_tokens=3000)
    _trace("next %s guide %.1fs ok=%s prompt_chars=%d" % (
        run_id[:8], time.time() - _t1, res.get("ok"), len("\n".join(parts))))
    run["files_done"] += len(blocks)
    if not res.get("ok"):
        first = idents[0] if idents else ""
        # Honest books: a fruitless call still burned time/tokens.
        run["spent"] += 1
        # Fuse + requeue (not blind skip): a dribble-hung call usually
        # passes on retry once the endpoint recovers. First consecutive
        # failure pushes the files back for the next round; the second
        # consecutive failure consumes them and moves on. Any success
        # resets the counter (see below).
        fails = int(run.get("guide_fails") or 0) + 1
        run["guide_fails"] = fails
        if fails <= 1:
            run["files_done"] -= len(blocks)
            read = run.setdefault("read", set())
            for ident in reversed(idents):
                read.discard(_node_id("file", ident))
                run["stack"].append({"kind": "file", "id": ident})
            run["trace"].append("檔 %s…：嚮導沒回（%s），退回重排" % (
                first, (res.get("error") or "guide failed")[:40]))
        else:
            run["trace"].append("檔 %s…：嚮導連跪兩次，跳過 %d" % (first, len(blocks)))
        return {"ok": True, "done": False, "node": first, "kind": "file",
                "batch": [{"node": i, "kind": "file", "concepts": [], "pushed": []}
                          for i in idents],
                "error": res.get("error") or "guide failed",
                "spent": run["spent"], "stack_left": len(run["stack"]),
                "trace_tail": (run["trace"] or [])[-5:]}
    run["spent"] += 1
    run["guide_fails"] = 0
    _t2 = time.time()
    by_file = _split_batch_reply(res.get("text") or "", idents)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    batch_out = []
    try:
        con = sqlite3.connect(db_path)
        for b in blocks:
            ident = b["ident"]
            text = b["text"] or ""
            parsed = by_file.get(ident) or []
            staged, pushed = [], []
            for verb, name, why in parsed:
                if verb == "念":
                    # Verbatim gate: a 念 that isn't the file's own words is a
                    # ghost - it can never locate (no line), never link, never
                    # tag. Drop it here, not in the draft overlay.
                    if not name or name in rej or len(name) > 30 or name not in text:
                        continue
                    for kind2 in ("link", "tag"):
                        try:
                            con.execute(
                                "INSERT OR IGNORE INTO staged_items"
                                "(run_id, repo, file, mention, concept, kind, status, created_at)"
                                " VALUES(?, ?, ?, ?, '', ?, 'staged', ?)",
                                (run_id, repo, ident, name, kind2, now))
                        except Exception:
                            pass
                    staged.append({"term": name, "why": why})
                elif verb == "入":
                    for st in _norm_target(db_path, name, repo)[:2]:
                        nid = _node_id(st["kind"], st["id"])
                        if nid not in run["seen"] and len(pushed) < MAX_PUSH:
                            run["seen"].add(nid)
                            run["stack"].append({"kind": st["kind"], "id": st["id"]})
                            pushed.append(nid)
            run["trace"].append("檔 %s：念 %d，入 %d" % (ident, len(staged), len(pushed)))
            batch_out.append({"node": ident, "kind": "file",
                              "concepts": staged, "pushed": pushed})
        con.commit()
        con.close()
    except Exception:
        for b in blocks:
            batch_out.append({"node": b["ident"], "kind": "file",
                              "concepts": [], "pushed": []})
    _trace("next %s parsedb %.1fs staged=%d" % (
        run_id[:8], time.time() - _t2,
        sum(len(x.get("concepts", [])) for x in batch_out)))
    first = idents[0] if idents else ""
    return {"ok": True, "done": False, "node": first, "kind": "file",
            "batch": batch_out, "spent": run["spent"],
            "stack_left": len(run["stack"]),
            "trace_tail": (run["trace"] or [])[-5:]}


def _split_batch_reply(text, idents):
    """Split a multi-file LLM reply into {file_ident: [(verb, name, why)]}.

    Sections start with `@檔：<ident>` (full or basename match); lines
    before the first marker are ignored. If no markers at all, the whole
    reply is attributed to the FIRST ident (model sometimes forgets).
    """
    out = {}
    cur = None
    basemap = {os.path.basename(i): i for i in idents}
    for ln in _txt(text).split("\n"):
        t = ln.strip()
        m = re.match(r"^@檔[:：]\s*(.+?)\s*$", t)
        if m:
            name = m.group(1).strip()
            cur = None
            for i in idents:
                if name == i or name == os.path.basename(i) or i.endswith(name):
                    cur = i
                    break
            if cur is None and name in basemap:
                cur = basemap[name]
            if cur is not None:
                out.setdefault(cur, [])
            continue
        if cur is None:
            continue
        # Reuse the single-line parser (走念入留去题題…).
        for verb, n, w in _parse_lines(t):
            out.setdefault(cur, []).append((verb, n, w))
    # Fallback: model answered without @檔 markers — blame the first file.
    if not out and idents:
        out[idents[0]] = _parse_lines(text)
    return out


def FnCrawlNext(run_id, max_files=MAX_FILES_PER_RUN):
    """Step 2-3: pop nodes (LIFO). CONCEPT nodes expand free via CPU;
    FILE nodes batch up to BATCH_FILE_NEXT into ONE LLM call."""
    run = _RUNS.get(run_id)
    if not run:
        return {"ok": False, "error": "unknown run (server restarted?)"}
    _trace("next %s entry stack=%d files_done=%d" % (
        (run_id or "")[:8], len(run.get("stack") or []),
        run.get("files_done", 0)))
    db_path, repo = run["db"], run["repo"]
    if not run["stack"]:
        return {"ok": True, "done": True, "spent": run["spent"]}
    cap = max(1, max_files or MAX_FILES_PER_RUN)
    if run["files_done"] >= cap:
        return {"ok": True, "done": True, "capped": True, "spent": run["spent"]}
    read = run.setdefault("read", set())
    file_idents, concept_cur = [], None
    # Drain the LIFO stack: FILE nodes join the batch; the FIRST concept
    # (if no files collected yet) expands free right away; later concepts
    # go back so the next call expands them. Never lose a node.
    # NOTE (livelock fix): the old code append()ed a deferred concept back
    # onto the stack TOP inside the loop — the next pop() drew the SAME
    # item again (read was discarded), an infinite self-cycle that wedged
    # the Flask worker forever (the 5-min hang: entry logged, nothing
    # after). Deferred concepts now park in a side list and return to the
    # stack only after the loop, original order preserved.
    deferred = []
    while run["stack"] and len(file_idents) < BATCH_FILE_NEXT:
        cand = run["stack"].pop()
        nid = _node_id(cand["kind"], cand["id"])
        if nid in read:
            continue
        read.add(nid)
        if cand["kind"] == "file":
            file_idents.append(cand["id"])
        elif concept_cur is None and not file_idents:
            # Free CPU expand now (returns immediately after loop).
            concept_cur = cand
            break
        else:
            # Concept after files (or second concept): park aside.
            deferred.append(cand)
    for cand in reversed(deferred):
        run["stack"].append(cand)
        read.discard(_node_id(cand["kind"], cand["id"]))
    if concept_cur is not None and not file_idents:
        return _process_concept_node(run, db_path, concept_cur["id"])
    if not file_idents:
        return {"ok": True, "done": True, "spent": run["spent"]}
    # Cap remaining files this round so max_files is respected.
    room = max(0, cap - run["files_done"])
    file_idents = file_idents[:room]
    if not file_idents:
        return {"ok": True, "done": True, "capped": True, "spent": run["spent"]}
    return _process_file_nodes(run, run_id, db_path, repo, file_idents)


def FnCrawlFinish(run_id):
    """Step 4: ONE LLM call judges all staged + recommends ONE title."""
    run = _RUNS.get(run_id)
    if not run:
        return {"ok": False, "error": "unknown run (server restarted?)"}
    db_path, repo = run["db"], run["repo"]
    try:
        con = sqlite3.connect(db_path)
        rows = con.execute(
            "SELECT DISTINCT file, mention FROM staged_items"
            " WHERE run_id = ? AND status = 'staged'", (run_id,)).fetchall()
        con.close()
    except Exception:
        rows = []
    if not rows:
        _RUNS.pop(run_id, None)
        return {"ok": True, "done": True, "title": "", "kept": [],
                "note": "nothing staged this round", "spent": run["spent"]}
    lines = "\n".join("檔 %s 念 %s" % (f, m) for f, m in rows[:60])
    res = FnVineGuide([
        {"role": "system", "content": "你是知識庫的終審。用繁體中文。"},
        {"role": "user", "content":
         "使用者在找：%s\n整輪摸到的暫存（檔＋念到的詞）：\n%s\n\n任務一：逐條判留去，"
         "只留跟使用者想找的相關的，每行 `留：詞 @ 檔` 或 `去：詞 @ 檔`。"
         "任務二：依全部語意薦一個最能回答它的概念詞作標題，"
          "一行 `題：詞｜由：八字`。只要行，不要解釋。" % (run.get("seed") or "", lines)},
    ], max_tokens=3000)
    if not res.get("ok"):
        return {"ok": False, "error": res.get("error") or "guide failed"}
    run["spent"] += 1
    parsed = _parse_lines(res.get("text") or "")
    keep = {(n.split("@")[0].strip(), n.split("@")[1].strip() if "@" in n else "")
            for v, n, _w in parsed if v == "留" and not _is_noise(n.split("@")[0].strip())}
    drop = {(n.split("@")[0].strip(), n.split("@")[1].strip() if "@" in n else "")
            for v, n, _w in parsed if v == "去"}
    titles = [(n, w) for v, n, w in parsed if v in ("題", "题")]
    title, why = (titles[0] if titles else ("", ""))
    try:
        con = sqlite3.connect(db_path)
        for f, m in rows:
            st = "kept" if ((m, f) in keep or (m, "") in keep) else (
                "dropped" if ((m, f) in drop or (m, "") in drop) else "kept")
            con.execute(
                "UPDATE staged_items SET status = ? WHERE run_id = ?"
                " AND file = ? AND mention = ?", (st, run_id, f, m))
        con.commit()
        kept = con.execute(
            "SELECT DISTINCT file, mention FROM staged_items"
            " WHERE run_id = ? AND status = 'kept'", (run_id,)).fetchall()
        con.close()
    except Exception:
        kept = []
    run["title"], run["spent_final"] = title, run["spent"]
    # Node landing for the dialog checklist (same resolver as the draft
    # overlay): mention -> heading + line, so rows render sections.
    _loc = {}
    out = []
    for f, m in kept:
        if _is_noise(m):
            continue
        key = (f, m)
        if key not in _loc:
            _loc[key] = _locate_mention(repo, f, m) or {}
        loc = _loc[key]
        out.append({"file": f, "term": m, "line": loc.get("line"),
                    "heading": loc.get("heading"), "level": loc.get("level", 0)})
    return {"ok": True, "done": True, "title": title, "why": why,
            "kept": out,
            "trace": run["trace"], "spent": run["spent"],
            "model": run.get("model") or ""}


def FnCrawlRun(repo, seed_text="", max_starts=MAX_STARTS, max_files=MAX_FILES_PER_RUN):
    """The whole crawl flow as ONE Function (holy steps 1-4, minus human).

    start -> next until the stack empties/caps -> finish. Stops BEFORE
    confirm on purpose: the caller (dialog, script, MCP) shows the
    recommended title to the human, then calls FnCrawlConfirm(run_id,
    title). The dialog keeps its own stepwise loop ONLY for per-file
    progress display; the flow itself lives here.
    Returns {ok, run_id, repo, picks, files, title, why, kept, spent,
             capped, trace, model}.
    """
    st = FnCrawlStart(repo, seed_text, max_starts=max_starts)
    if not st.get("ok"):
        return {"ok": False, "error": st.get("error") or "start failed",
                "guide_text": st.get("guide_text") or ""}
    run_id = st["run_id"]
    files, capped = 0, False
    for _ in range(max(1, max_files or MAX_FILES_PER_RUN) + 8):
        nx = FnCrawlNext(run_id, max_files=max_files)
        if not nx.get("ok"):
            return {"ok": False, "error": nx.get("error") or "next failed",
                    "run_id": run_id}
        if nx.get("kind") == "file" and nx.get("node"):
            files += 1
        if nx.get("done"):
            capped = bool(nx.get("capped"))
            break
    fin = FnCrawlFinish(run_id)
    if not fin.get("ok"):
        return {"ok": False, "error": fin.get("error") or "finish failed",
                "run_id": run_id}
    return {"ok": True, "run_id": run_id, "repo": repo,
            "picks": st.get("picks") or [], "files": files,
            "title": fin.get("title") or "", "why": fin.get("why") or "",
            "kept": fin.get("kept") or [], "spent": fin.get("spent", 0),
            "capped": capped, "trace": fin.get("trace") or [],
            "model": fin.get("model") or st.get("model") or ""}


def FnCrawlRefresh(repo, name, max_files=MAX_FILES_PER_RUN):
    """Pure Vine refresh: re-crawl seeded by an EXISTING candidate title,
    merge fresh kept rows into ITS draft (concept=name). Never creates a
    candidate - the dialog's confirm path is not touched. Pairs already
    kept under this title drop (no doubles on promote); only truly new
    (file, mention) pairs bind. Returns {ok, title, added, kept, spent,
    model}. Costs LLM like any crawl (1 + files + 1)."""
    name = (name or "").strip()
    if not repo or not name:
        return {"ok": False, "error": "repo and name required"}
    from .db import get_db_path as _p
    db_path = _p(repo)
    con = sqlite3.connect(db_path)
    try:
        row = con.execute(
            "SELECT status FROM concepts WHERE name = ?", (name,)).fetchone()
    finally:
        con.close()
    if not row or (row[0] or "") != "candidate":
        return {"ok": False, "error": "not a candidate: %s" % name}
    res = FnCrawlRun(repo, seed_text=name,
                     max_files=max(1, min(50, max_files or MAX_FILES_PER_RUN)))
    if not res.get("ok"):
        return res
    run_id = res.get("run_id", "")
    kept = res.get("kept") or []
    con = sqlite3.connect(db_path)
    try:
        existing = {(r[0], r[1]) for r in con.execute(
            "SELECT file, mention FROM staged_items"
            " WHERE repo = ? AND concept = ? AND status = 'kept'",
            (repo, name)).fetchall()}
        added = 0
        for k in kept:
            f, m = (k or {}).get("file"), (k or {}).get("term")
            if not f or not m:
                continue
            if (f, m) in existing:
                con.execute(
                    "UPDATE staged_items SET status = 'dropped'"
                    " WHERE run_id = ? AND status = 'kept'"
                    " AND file = ? AND mention = ?", (run_id, f, m))
            else:
                con.execute(
                    "UPDATE staged_items SET concept = ?"
                    " WHERE run_id = ? AND status = 'kept'"
                    " AND file = ? AND mention = ?", (name, run_id, f, m))
                added += 1
                existing.add((f, m))
        con.commit()
    finally:
        con.close()
    return {"ok": True, "title": name, "added": added,
            "kept": len(kept), "spent": res.get("spent", 0),
            "model": res.get("model") or ""}


def FnStageApproved(con, rp, term, files, now, run_prefix="scan-"):
    """Stage an approved term (mining confirm path): one confirmed run row
    plus link+tag kept rows per evidence file, concept bound at once (the
    human's approval IS the judge). Shared with the crawl confirm flow's
    semantics; on promote the same FnApplyStaged aligns hyperlinks.
    files: [{rel, ...}] (cap 20). Returns run_id ("" on total failure)."""
    import uuid as _uuid
    rid = "%s%s" % (run_prefix, _uuid.uuid4().hex[:12])
    try:
        con.execute(
            "INSERT OR REPLACE INTO staged_runs"
            "(run_id, repo, title, status, created_at)"
            " VALUES(?, ?, ?, 'confirmed', ?)",
            (rid, rp, term, now))
        rels = []
        for f in (files or [])[:20]:
            r = (f or {}).get("rel") if isinstance(f, dict) else None
            if r and r not in rels:
                rels.append(r)
        for r in rels:
            for k in ("link", "tag"):
                con.execute(
                    "INSERT OR IGNORE INTO staged_items"
                    "(run_id, repo, file, mention, concept, kind, status, created_at)"
                    " VALUES(?, ?, ?, ?, ?, ?, 'kept', ?)",
                    (rid, rp, r, term, term, k, now))
    except Exception:
        return ""
    return rid


def FnRecountTopUpStaged(db_path, repo, term):
    """Recount companion: top up staged spots for a Prospect candidate.

    FnRecountOneTerm only rewrites scan_evidence (numbers) - the draft
    stays frozen at whatever the approval moment staged. So 更新 looks
    dead: "3 docs 91 hits" yet still 1 spot. This stages link+tag kept
    rows (concept bound = term, same shape as FnStageApproved) for every
    evidence file NOT already covered by a kept row. Pure CPU, zero LLM.
    Only Prospect candidates qualify (officials have no draft; Vine
    drafts are mention-specific, never term-blanket). Total kept files
    capped at 20, same as FnStageApproved. Returns {ok, added, covered,
    total_files}."""
    import json as _json
    term = (term or "").strip()
    if not repo or not term:
        return {"ok": False, "error": "repo and term required"}
    FnEnsureStagedTables(db_path)
    con = sqlite3.connect(db_path)
    try:
        row = con.execute(
            "SELECT status, category FROM concepts WHERE name = ?",
            (term,)).fetchone()
        if not row or (row[0] or "") != "candidate":
            return {"ok": True, "added": 0, "skipped": "not a candidate"}
        if (row[1] or "").strip() in ("Vine", "順藤摸瓜"):
            return {"ok": True, "added": 0, "skipped": "vine draft is mention-specific"}
        ev = con.execute(
            "SELECT sources_json FROM scan_evidence WHERE term = ?",
            (term,)).fetchone()
        try:
            files = _json.loads((ev[0] if ev else None) or "[]")
        except Exception:
            files = []
        rels = []
        for f in files or []:
            r = (f or {}).get("rel") if isinstance(f, dict) else None
            if r and r not in rels:
                rels.append(r)
        covered = {r[0] for r in con.execute(
            "SELECT DISTINCT file FROM staged_items"
            " WHERE repo = ? AND concept = ? AND status = 'kept'",
            (repo, term)).fetchall()}
        fresh = [r for r in rels if r not in covered][:max(0, 20 - len(covered))]
        if not fresh:
            return {"ok": True, "added": 0, "covered": len(covered),
                    "total_files": len(rels)}
        rid = "recount-%s" % uuid.uuid4().hex[:12]
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        try:
            con.execute(
                "INSERT OR REPLACE INTO staged_runs"
                "(run_id, repo, title, status, created_at)"
                " VALUES(?, ?, ?, 'confirmed', ?)", (rid, repo, term, now))
            for r in fresh:
                for k in ("link", "tag"):
                    con.execute(
                        "INSERT INTO staged_items"
                        "(run_id, repo, file, mention, concept, kind, status, created_at)"
                        " VALUES(?, ?, ?, ?, ?, ?, 'kept', ?)",
                        (rid, repo, r, term, term, k, now))
            con.commit()
        except Exception as e:
            return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        return {"ok": True, "added": len(fresh),
                "covered": len(covered) + len(fresh), "total_files": len(rels)}
    finally:
        con.close()


def FnCrawlConfirm(run_id, title, keep=None):
    """Human-edited title -> candidate pool; staged rows bound to it.

    keep: optional [{term, file}] (or "term@file" strings) - the per-item
    去留 from the checklist. Listed rows stay kept+bound; other kept rows
    drop. keep=None (old callers) binds everything, as before."""
    run = _RUNS.get(run_id)
    if not run:
        return {"ok": False, "error": "unknown run (server restarted?)"}
    db_path, repo = run["db"], run["repo"]
    title = (title or "").strip()
    if not title or len(title) > 30:
        return {"ok": False, "error": "title 1-30 chars required"}
    if title in _rejected(db_path):
        return {"ok": False, "error": "title is blacklisted"}
    from .db import save_concept
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        con = sqlite3.connect(db_path)
        known = {r[0] for r in con.execute("SELECT name FROM concepts")}
        con.close()
    except Exception:
        known = set()
    if title in known:
        return {"ok": False, "error": "already an official/candidate tag"}
    keep_set = None
    if keep is not None:
        keep_set = set()
        for k in keep or []:
            if isinstance(k, dict) and k.get("term"):
                keep_set.add(((k.get("term") or "").strip(), (k.get("file") or "").strip()))
            elif isinstance(k, str) and k.strip():
                s = k.strip()
                if "@" in s:
                    t, _, f = s.rpartition("@")
                    keep_set.add((t.strip(), f.strip()))
                else:
                    keep_set.add((s, ""))
        if not keep_set:
            return {"ok": False, "error": "keep at least one item"}
    res = save_concept(repo, title, "Vine", "", "candidate")
    if not (res or {}).get("ok"):
        return {"ok": False, "error": (res or {}).get("error") or "save failed"}
    try:
        con = sqlite3.connect(db_path)
        con.execute(
            "INSERT OR REPLACE INTO staged_runs(run_id, repo, title, status, created_at)"
            " VALUES(?, ?, ?, 'confirmed', ?)", (run_id, repo, title, now))
        if keep_set is not None:
            for f, m in con.execute(
                    "SELECT file, mention FROM staged_items"
                    " WHERE run_id = ? AND status = 'kept'", (run_id,)).fetchall():
                if (m, f) not in keep_set and (m, "") not in keep_set:
                    con.execute(
                        "UPDATE staged_items SET status = 'dropped'"
                        " WHERE run_id = ? AND status = 'kept' AND file = ? AND mention = ?",
                        (run_id, f, m))
        con.execute(
            "UPDATE staged_items SET concept = ? WHERE run_id = ? AND status = 'kept'",
            (title, run_id))
        con.commit()
        con.close()
    except Exception:
        pass
    _RUNS.pop(run_id, None)
    try:
        from .db import record_log
        record_log(repo, "CRAWL_CONFIRM",
                   summary="title=%s run=%s" % (title, run_id))
    except Exception:
        pass
    return {"ok": True, "title": title}


def _locate_mention(repo, rel, mention):
    """(file rel, mention) -> {line, heading, level} or {}: first line
    containing the mention + nearest preceding # heading. Pure CPU, no LLM.
    Feeds the draft overlay so rows jump to SECTIONS, not file tops."""
    import os as _os
    import re as _re
    try:
        with open(_os.path.join(repo, rel or ""), "r",
                  encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        return {}
    if not lines:
        return {}
    keys = [mention] if mention else []
    if mention and len(mention) > 30:
        keys.append(mention[:30])
    hit = 0
    for k in keys:
        if not k:
            continue
        kl = k.lower()
        for i, ln in enumerate(lines):
            if k in ln or kl in (ln or "").lower():
                hit = i + 1
                break
        if hit:
            break
    if not hit:
        return {}
    heading, level = "", 0
    for ln in reversed(lines[max(0, hit - 501):hit - 1]):
        m = _re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", ln or "")
        if m:
            level = len(m.group(1))
            heading = (m.group(2) or "").strip()
            break
    out = {"line": hit}
    if heading:
        out["heading"] = heading[:60]
        out["level"] = level
    return out


def FnCandidateDraft(repo, title):
    """Read-only draft behind a candidate card: the kept staged rows bound
    to this confirmed title (+ the confirming run). Prospect candidates
    have no staged rows — the frontend shows mining evidence instead."""
    from .db import get_db_path as _p
    title = (title or "").strip()
    if not repo or not title:
        return {"ok": False, "error": "repo and title required"}
    db_path = _p(repo)
    FnEnsureStagedTables(db_path)
    con = sqlite3.connect(db_path)
    try:
        run = con.execute(
            "SELECT run_id, created_at FROM staged_runs"
            " WHERE repo = ? AND title = ? ORDER BY created_at DESC LIMIT 1",
            (repo, title)).fetchone()
        rows = con.execute(
            "SELECT file, mention, kind, run_id, created_at FROM staged_items"
            " WHERE repo = ? AND concept = ? AND status = 'kept'"
            " ORDER BY file, created_at",
            (repo, title)).fetchall()
    finally:
        con.close()
    out_rows = []
    _loc_cache = {}
    for r in rows:
        key = (r[0] or "", r[1] or "")
        if key not in _loc_cache:
            _loc_cache[key] = _locate_mention(repo, r[0], r[1])
        loc = _loc_cache[key] or {}
        out_rows.append({"file": r[0], "mention": r[1], "kind": r[2],
                         "run_id": r[3], "created_at": r[4],
                         "line": loc.get("line"),
                         "heading": loc.get("heading"),
                         "level": loc.get("level", 0)})
    return {"ok": True, "title": title,
            "run": {"run_id": run[0], "created_at": run[1]} if run else None,
            "rows": out_rows}


def FnDetachStaged(repo, title, drop):
    """Draft overlay 脫鉤: mark kept rows (concept=title) dropped for the
    given [{file, mention}] (or "mention@file" strings). Candidate row
    itself untouched; counts refresh on next fetch."""
    from .db import get_db_path as _p
    title = (title or "").strip()
    if not repo or not title:
        return {"ok": False, "error": "repo and title required"}
    pairs = set()
    for k in drop or []:
        if isinstance(k, dict) and k.get("mention") is not None:
            pairs.add(((k.get("mention") or "").strip(), (k.get("file") or "").strip()))
        elif isinstance(k, str) and k.strip():
            s = k.strip()
            if "@" in s:
                m, _, f = s.rpartition("@")
                pairs.add((m.strip(), f.strip()))
            else:
                pairs.add((s, ""))
    if not pairs:
        return {"ok": False, "error": "nothing to detach"}
    db_path = _p(repo)
    FnEnsureStagedTables(db_path)
    con = sqlite3.connect(db_path)
    try:
        n = 0
        for m, f in pairs:
            if f:
                cur = con.execute(
                    "UPDATE staged_items SET status = 'dropped'"
                    " WHERE repo = ? AND concept = ? AND status = 'kept'"
                    " AND file = ? AND mention = ?", (repo, title, f, m))
            else:
                cur = con.execute(
                    "UPDATE staged_items SET status = 'dropped'"
                    " WHERE repo = ? AND concept = ? AND status = 'kept'"
                    " AND mention = ?", (repo, title, m))
            n += cur.rowcount
        con.commit()
    finally:
        con.close()
    return {"ok": True, "title": title, "detached": n}


def _h1_lines(lines):
    """0-based indices of H1 title lines (the doc-title zone, mirrored from
    the source file path: never linkified, never tagged, never scanned)."""
    out = set()
    for i, ln in enumerate(lines or []):
        m = re.match(r"^(#{1,6})\s+", (ln or "").strip())
        if m and len(m.group(1)) == 1:
            out.add(i)
    return out


def _srczone_lines(lines):
    """0-based indices of source-file provenance lines (never linkified,
    never tagged, never scanned): `來源檔案` markers, lone backticked
    office paths, and ingest stamp lines. Both flows obey (shared apply)."""
    out = set()
    for i, ln in enumerate(lines or []):
        s = (ln or "").strip()
        if "來源檔案" in s:
            out.add(i)
            continue
        if re.search(r"`[^`]{1,120}\.(pptx?|pdf|docx?|xlsx?|csv|txt)`", s,
                      re.IGNORECASE):
            # Backticked office path anywhere on the line: source-file
            # provenance (quoted or bare), never tag evidence.
            out.add(i)
            continue
        if s.startswith(">") and "匯入時間" in s:
            out.add(i)
    return out


def _convert_bracket_mentions(text, mention_titles, md_dir, tags_dir,
                              ci=False, skip=None):
    """Turn [[M]] into [M](tags/Title.md) for staged (non-official) mentions.

    Official M keep their brackets (they link correctly already; hijacking
    them to another title's page would corrupt their linkage). Fence and
    inline-code aware; existing [...](...) links untouched. Longest first.
    ci=True matches bracket surface case-insensitively (evidence varies in
    case); the link keeps the file's original surface text.
    Returns (new_text, n_converted).
    """
    if not text or not mention_titles:
        return text, 0
    fence_pat = re.compile(r"^(`{3,}|~{3,})")
    shield_pat = re.compile(r"`[^`\n]+`|\[[^\]\n]*\]\([^)\n]*\)")
    items = sorted(
        ((m, t) for m, t in mention_titles.items()
         if m and t and not any(c in m for c in "]()")),
        key=lambda kv: -len(kv[0]))
    if not items:
        return text, 0
    converted = 0
    out_lines = []
    in_fence = False
    skip = skip or set()
    for li, line in enumerate(text.splitlines()):
        if fence_pat.match(line.strip()):
            in_fence = not in_fence
            out_lines.append(line)
            continue
        if in_fence or li in skip:
            out_lines.append(line)
            continue
        for m_txt, title in items:
            tag_rel = os.path.relpath(
                os.path.join(tags_dir, title + ".md"), md_dir).replace("\\", "/")
            flags = re.IGNORECASE if ci else 0
            pat = re.compile(r"\[\[(" + re.escape(m_txt) + r")\]\]", flags)
            while True:
                shields = [(x.start(), x.end()) for x in shield_pat.finditer(line)]

                def _sh(a, b):
                    return any(a < e and b > st for st, e in shields)

                matches = [mm for mm in pat.finditer(line)
                           if not _sh(mm.start(), mm.end())]
                if not matches:
                    break
                for mm in reversed(matches):
                    tag = "[%s](%s)" % (mm.group(1), tag_rel)
                    line = line[:mm.start()] + tag + line[mm.end():]
                    converted += 1
        out_lines.append(line)
    return "\n".join(out_lines), converted


def _official_terms(db_path):
    """Names + aliases of official concepts (their linkage is untouchable)."""
    terms = set()
    try:
        con = sqlite3.connect(db_path)
        try:
            for (nm,) in con.execute(
                    "SELECT name FROM concepts WHERE status = 'official'"):
                if nm:
                    terms.add(nm)
            for (al,) in con.execute(
                    "SELECT aliases FROM concepts WHERE status = 'official'"):
                for a in (al or "").replace("、", ",").split(","):
                    a = a.strip()
                    if a:
                        terms.add(a)
        finally:
            con.close()
    except Exception:
        pass
    return terms


def FnSweepStaged(repo, stale_days=1, dropped_days=30):
    """GC for staged rows. Returns {swept_staged, swept_dropped, swept_orphan}.

    - status='staged' older than stale_days: its run died mid-crawl (live
      runs finish in minutes; a restart orphans the stack) -> DELETE.
    - status='dropped' older than dropped_days: audit window passed -> DELETE.
    - status='kept' with NO staged_runs row (judged but never confirmed, so
      it can never promote) older than stale_days -> DELETE. Confirmed
      (pending promote) and applied (audit) live on.
    """
    from .db import get_db_path as _p
    db_path = _p(repo)
    if not db_path or not os.path.isfile(db_path):
        return {"ok": False, "error": "no db"}
    FnEnsureStagedTables(db_path)
    now = time.time()
    cut_stale = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now - stale_days * 86400))
    cut_drop = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now - dropped_days * 86400))
    out = {"ok": True, "swept_staged": 0, "swept_dropped": 0, "swept_orphan": 0}
    try:
        con = sqlite3.connect(db_path)
        try:
            cur = con.execute(
                "DELETE FROM staged_items WHERE status = 'staged' AND created_at < ?",
                (cut_stale,))
            out["swept_staged"] = cur.rowcount or 0
            cur = con.execute(
                "DELETE FROM staged_items WHERE status = 'dropped' AND created_at < ?",
                (cut_drop,))
            out["swept_dropped"] = cur.rowcount or 0
            cur = con.execute(
                "DELETE FROM staged_items WHERE status = 'kept' AND created_at < ?"
                " AND run_id NOT IN (SELECT run_id FROM staged_runs)",
                (cut_stale,))
            out["swept_orphan"] = cur.rowcount or 0
            con.commit()
        finally:
            con.close()
    except Exception as e:
        out["ok"] = False
        out["error"] = "%s: %s" % (type(e).__name__, e)
    return out


def _strip_legacy_title_lines(lines, title):
    """Drop my-pattern `- [Title](tags/…)` lines for THIS title only.

    The ## 關聯概念 header goes too iff its list block ends up empty.
    Anything user-written (non-matching lines) is never touched; a section
    with zero of my lines is left entirely alone. Returns (lines, n).
    """
    hdr = re.compile(r"^##\s*關聯概念\s*$")
    mine = re.compile(r"^-\s*\[[^\]]+\]\([^)\n]*tags/[^)\n]*\.md[^)\n]*\)\s*$")
    out, i, dropped = [], 0, 0
    n = len(lines)
    while i < n:
        if hdr.match(lines[i].strip()):
            j = i + 1
            block = []
            touched = False
            while j < n:
                s = lines[j].strip()
                if not s:
                    block.append((lines[j], "blank", ""))
                    j += 1
                    continue
                if mine.match(s):
                    mm = re.match(r"^-\s*\[([^\]]+)\]", s)
                    t = mm.group(1).strip() if mm else ""
                    block.append((lines[j], "mine", t))
                    j += 1
                    continue
                touched = True
                break
            if touched or not any(k == "mine" for (_, k, _) in block):
                # User content inside, or no list of mine at all: hands off.
                out.append(lines[i])
                for ln, _, _ in block:
                    out.append(ln)
                i = j
                continue
            kept = [(ln, k, t) for (ln, k, t) in block
                    if not (k == "mine" and t == title)]
            dropped += sum(1 for (_, k, t) in block
                           if k == "mine" and t == title)
            if any(k == "mine" for (_, k, _) in kept):
                # Other titles still live here: header stays.
                out.append(lines[i])
                for ln, _, _ in kept:
                    out.append(ln)
            # else: header + its emptied list vanish together.
            i = j
            continue
        out.append(lines[i])
        i += 1
    return out, dropped


def _place_heading_tags(lines, title, tag_rel, mentions, url_hint="", skip=()):
    """Insert/merge `> 🏷️ 標籤： [Title](rel)` under each heading whose
    section contains a staged mention. THE standard node-tag form: the tag
    rides with its node, provenance intact. Bottom-up. Fence aware; existing
    tag lines merge (no duplicates). url_hint (e.g. 'tags/Title.md') also
    counts as occurrence: catches links whose surface differs from any
    staged mention. skip: 0-based lines excluded from occurrence search AND
    anchors (H1 title zone). Returns (lines, n_placed)."""
    if not mentions or not title:
        return lines, 0
    heads = []
    for i, ln in enumerate(lines):
        m = re.match(r"^\s{0,3}(#{1,4})\s+(.+)$", ln)
        if m:
            heads.append((i, len(m.group(1))))
    if not heads:
        return lines, 0
    fence_pat = re.compile(r"^(`{3,}|~{3,})")
    tagline_pat = re.compile(r"^\s*>\s*🏷️?\s*標籤\s*[:：]")
    in_fence = [False] * len(lines)
    fl = False
    for i, ln in enumerate(lines):
        if fence_pat.match(ln.strip()):
            fl = not fl
            continue
        in_fence[i] = fl

    def _hit(ln):
        if url_hint and url_hint in ln:
            return True
        for m in mentions:
            if not m:
                continue
            if any(ord(c) > 127 for c in m):
                if m in ln:
                    return True
            elif re.search(r"(?<![A-Za-z0-9_])" + re.escape(m) + r"(?![A-Za-z0-9_])",
                           ln, re.IGNORECASE):
                return True
        return False

    want = []
    skip = skip or set()
    for i, ln in enumerate(lines):
        if i in skip or in_fence[i] or tagline_pat.match(ln):
            continue
        if not _hit(ln):
            continue
        h = -1
        for (hi, _lv) in heads:
            if hi < i:
                h = hi
            else:
                break
        if h >= 0 and h not in skip and h not in want:
            want.append(h)
    placed = 0
    tag_html = "[%s](%s)" % (title, tag_rel)
    for h in sorted(want, reverse=True):
        j = h + 1
        while j < len(lines) and not lines[j].strip():
            j += 1
        if j < len(lines) and tagline_pat.match(lines[j]):
            if tag_html in lines[j]:
                continue
            lines[j] = lines[j].rstrip() + "、" + tag_html
            placed += 1
        else:
            lines.insert(h + 1, "> 🏷️ 標籤： " + tag_html)
            placed += 1
    return lines, placed


def _count_links(text, mentions):
    """Honest count of `[M](` links ([[M]] never contains `[M](`)."""
    return sum((text or "").count("[%s](" % m) for m in (mentions or {}) if m)


def _apply_file(abs_p, text, mentions, title, official, tags_dir):
    """Transform one file to the standard: legacy section stripped for
    this title, inline links (bare + converted brackets), heading tag
    lines. Pure transform (no I/O); caller writes + counts the file.
    Returns (new_text, links_added)."""
    todo = {m: title for m in (mentions or []) if m and m not in official}
    md_dir = os.path.dirname(abs_p)
    tag_rel = _tag_rel(md_dir, tags_dir, title)
    # Off-limits zones (shared by both flows): H1 title lines (mirrored
    # source path) + source-file provenance lines. Never linked, tagged
    # or scanned for occurrences.
    raw_lines = text.splitlines()
    off = _h1_lines(raw_lines) | _srczone_lines(raw_lines)
    # 1. Strip legacy system-section lines for THIS title.
    lines, _ = _strip_legacy_title_lines(raw_lines, title)
    # Line numbers shift after stripping: recompute off-limits on the
    # stripped text by re-matching (H1/srczone lines are never stripped).
    off = _h1_lines(lines) | _srczone_lines(lines)
    new_text = "\n".join(lines)
    links = 0
    if todo:
        new_text, n_conv = _convert_bracket_mentions(
            new_text, todo, md_dir, tags_dir, ci=True, skip=off)
        links += n_conv
        before = _count_links(new_text, todo)
        new_text = FnLinkifyConcepts(new_text, dict(todo), md_dir, tags_dir,
                                     case_insensitive=True,
                                     skip_lines=_h1_lines(new_text.splitlines()) | _srczone_lines(new_text.splitlines()))
        links += _count_links(new_text, todo) - before
    # 2. Node tags in THE standard form under evidencing headings.
    tag_lines, _ = _place_heading_tags(
        new_text.splitlines(), title, tag_rel,
        [m for m in (mentions or []) if m],
        skip=_h1_lines(new_text.splitlines()) | _srczone_lines(new_text.splitlines()))
    return "\n".join(tag_lines), links


def FnApplyStaged(repo, title):
    """Step 5: on promote, kept staged rows materialize in THE standard
    forms only: inline [mention](tags/Title.md) links in body text, plus
    `> 🏷️ 標籤： [Title](rel)` node-tag lines under each evidencing
    heading. Legacy ## 關聯概念 lines for this title are stripped.
    Files re-sync afterwards by caller."""
    from .db import get_db_path as _p
    db_path = _p(repo)
    if not db_path or not os.path.isfile(db_path):
        return {"ok": False, "error": "no db"}
    FnEnsureStagedTables(db_path)
    try:
        con = sqlite3.connect(db_path)
        rows = con.execute(
            "SELECT DISTINCT file, mention FROM staged_items"
            " WHERE repo = ? AND concept = ? AND status = 'kept'", (repo, title)).fetchall()
        con.close()
    except Exception:
        rows = []
    if not rows:
        return {"ok": True, "applied": 0}
    official = _official_terms(db_path) - {title}
    repo_real = os.path.realpath(repo)
    tags_dir = os.path.join(repo_real, ".docgraphical", "tags")
    applied_files, applied_links = [], 0
    by_file = {}
    for f, m in rows:
        by_file.setdefault(f, []).append(m)
    for rel, mentions in by_file.items():
        # System-generated catalog recompiles every sync: writing staged
        # links into it is sand-writing (wiped next sync). Drop those rows.
        if os.path.basename(rel).upper() == "DOC_CATALOG.MD":
            try:
                con = sqlite3.connect(db_path)
                con.execute(
                    "UPDATE staged_items SET status = 'dropped'"
                    " WHERE repo = ? AND concept = ? AND file = ? AND status = 'kept'",
                    (repo, title, rel))
                con.commit()
                con.close()
            except Exception:
                pass
            continue
        abs_p = os.path.join(repo_real, rel)
        if not os.path.isfile(abs_p):
            continue
        try:
            with open(abs_p, "r", encoding="utf-8") as fh:
                text = fh.read()
        except Exception:
            continue
        todo = {m: title for m in mentions if m and m not in official}
        new_text, n_links = _apply_file(
            abs_p, text, mentions, title, official, tags_dir)
        applied_links += n_links
        if new_text != text:
            try:
                with open(abs_p, "w", encoding="utf-8") as fh:
                    fh.write(new_text)
                applied_files.append(rel)
            except Exception:
                continue
    if applied_files:
        try:
            con = sqlite3.connect(db_path)
            con.execute(
                "UPDATE staged_items SET status = 'applied'"
                " WHERE repo = ? AND concept = ? AND status = 'kept'", (repo, title))
            con.commit()
            con.close()
        except Exception:
            pass
    return {"ok": True, "applied": len(applied_files), "files": applied_files,
            "links": applied_links}


def _tag_rel(md_dir, tags_dir, title):
    """Tag page path relative to an md's own directory."""
    try:
        rel = os.path.relpath(tags_dir, md_dir).replace("\\", "/")
    except Exception:
        rel = ".docgraphical/tags"
    return rel + "/" + title + ".md"
