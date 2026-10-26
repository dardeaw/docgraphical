# -*- coding: utf-8 -*-
"""Cross-document concept mining (llm-scan two-stage).

Stage 1 (CPU, free, deterministic): walk repo markdown files, CJK 2-4gram
counting, DF>=2, stopwords + length window, top-N by score.
Stage 2 (LLM judge, one call): pick genuine domain concepts, drop generic
words, flag merges with already-official concepts. Returns JSON.
Results land in the existing `concepts` table (status='candidate',
category='機器挖掘'); evidence (source files + snippets) goes to the
`scan_evidence` side table so the drawer can jump without touching
any existing endpoint shapes.
"""
import os
import re
import json
import time
import sqlite3

SCAN_MAX_INSERT = 20    # max new candidates per scan (human review budget)
SCAN_TOP_JUDGE = 120    # terms sent to the LLM judge (wider window so
                        # rare-but-real domain terms aren't crowded out
                        # by high-frequency generic fragments)
SCAN_NGRAMS = (2, 3, 4, 5, 6, 7, 8)
SCAN_MIN_LEN = 2
SCAN_MAX_LEN = 8

STOPWORDS = frozenset("""
的 是 在 和 與 或 但 而 並 與 其 此 該 每 各 某 另 另行
我們 你們 他們 您 妳 它 其 它們 大家 雙方
可以 應該 需要 必須 能夠 進行 使用 通過 採用 包括
這個 那個 一個 這些 那些 如何 什麼 怎麼 為什麼
以及 因為 所以 如果 但是 然而 因此 於是 接著 然後
例如 比如 譬如 如下 下列 以下 以上 等等 等 之一
目前 當前 今天 明天 昨天 今年 去年 最近 之後 之前
非常 很 更 最 太 都 也 還 又 再 就 才 便 僅 只 僅僅
進行綜上所述 總而言之 換句話說 需要注意 請注意
""".split())

# ASCII fragments from mixed-language text (trigram shrapnel like 'loo').
# Domain acronyms (BOM/CNC/LED) survive: only generic glue words listed.
EN_STOPWORDS = frozenset("""
the a an and or of to in on for with is are was were be been by at as
from that this it its it is are md pdf doc ppt txt png jpg file files
text content body head title html table td tr list item new use used
using also will shall may can not no yes via per each other more most
not can will just like get got set run one two three first second
name id no yes all any some none both each every when where how what
who why which there here now then still even also just only over under
after before between during until while about above below into onto
from with within without against along among through across behind
""".split())

_CJK_RUN = re.compile(r"[\u4e00-\u9fffA-Za-z0-9]+")
_FENCE = re.compile(r"(?s)```.*?```|~~~.*?~~~")
# ASCII whole words (CamelCase split): Cooler Master -> Cooler, Master.
_ASCII_WORD = re.compile(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+")

# Prospect mine cache: key=(repos_tuple, min_tf) -> {fp, result, ts}.
# Fingerprint = (file_count, sum(mtime_ns)) of all .md under the repos —
# cheap to recompute (one stat pass), invalidates automatically when any
# file is added/removed/touched. TTL caps staleness if mtime is lying.
_MINE_CACHE = {}
_MINE_CACHE_TTL = 300  # seconds; refresh button forces miss


def _mine_fingerprint(repo_paths):
    """Cheap corpus fingerprint: (n_md_files, total_mtime_ns)."""
    n, total = 0, 0
    for repo in repo_paths:
        repo = os.path.abspath(repo or "")
        if not repo or not os.path.isdir(repo):
            continue
        for root, dirs, files in os.walk(repo):
            dirs[:] = [d for d in dirs
                       if d not in (".docgraphical", ".docgraph", ".git", "node_modules")
                       and not d.startswith(".")]
            for f in files:
                if not f.lower().endswith(".md"):
                    continue
                n += 1
                try:
                    total += os.stat(os.path.join(root, f)).st_mtime_ns
                except OSError:
                    pass
    return (n, total)


def _FnStripCode(text):
    return _FENCE.sub("\n", text or "")


def _FnNorm(term):
    t = (term or "").strip().lower()
    t = t.replace("　", " ").strip()
    return t


def _FnIsJunk(term):
    if not term or len(term) < SCAN_MIN_LEN or len(term) > SCAN_MAX_LEN:
        return True
    if term in STOPWORDS:
        return True
    if re.fullmatch(r"[0-9.\-/:x×%]+", term):
        return True
    if re.fullmatch(r"[a-z]{1}", term):
        return True
    # ASCII-only fragments: generic glue rejected, domain acronyms kept.
    if re.fullmatch(r"[a-z0-9.\-/]+", term):
        if term in EN_STOPWORDS:
            return True
        if len(term) < 4 and term.upper() != term:
            return True
    return False


def FnMineCorpus(repo_paths, min_tf=1, refresh=False):
    """Walk md files, return scored cross-doc terms.

    Returns [{term, df, tf, files: [{rel, snippet}]}] sorted by score desc.
    DF>=2 always (cross-doc by definition); min_tf gates total mentions.

    Cache: results keyed by (repos, min_tf) + corpus fingerprint
    (file count + total mtime_ns). Hit if fingerprint matches and TTL
    not expired. refresh=True forces a re-mine (UI「重新掃描」鈕).
    """
    try:
        key = (tuple(sorted(os.path.abspath(r or "") for r in repo_paths)),
               int(min_tf))
    except Exception:
        key = (tuple(str(r) for r in repo_paths), min_tf)
    fp = _mine_fingerprint(repo_paths)
    if not refresh:
        hit = _MINE_CACHE.get(key)
        if hit and hit.get("fp") == fp and (time.time() - hit.get("ts", 0)) < _MINE_CACHE_TTL:
            return hit["result"]
    df = {}
    tf = {}
    evidence = {}
    for repo in repo_paths:
        repo = os.path.abspath(repo or "")
        if not repo or not os.path.isdir(repo):
            continue
        for root, dirs, files in os.walk(repo):
            dirs[:] = [d for d in dirs
                       if d not in (".docgraphical", ".docgraph", ".git", "node_modules")
                       and not d.startswith(".")]
            for f in files:
                if not f.lower().endswith(".md"):
                    continue
                full = os.path.join(root, f)
                try:
                    with open(full, "r", encoding="utf-8", errors="replace") as fh:
                        raw = fh.read()
                except OSError:
                    continue
                # Strip template boilerplate: blockquote header lines (source /
                # timestamp / model stamps identical across ingest outputs)
                # and hr rules would otherwise dominate DF with fake overlap.
                text = "\n".join(
                    ln for ln in _FnStripCode(raw).splitlines()
                    if ln.strip() and not ln.strip().startswith(">")
                    and ln.strip() not in ("---", "***", "___"))
                rel = os.path.relpath(full, repo).replace("\\", "/")
                seen_here = set()

                def _bump(term, pos, skip_junk=False):
                    if not skip_junk and _FnIsJunk(term):
                        return
                    tf[term] = tf.get(term, 0) + 1
                    if term not in seen_here:
                        seen_here.add(term)
                        df[term] = df.get(term, 0) + 1
                        ev = evidence.setdefault(term, [])
                        if len(ev) < 5:
                            s0 = max(0, pos - 24)
                            ev.append({"rel": rel,
                                       "snippet": text[s0:s0 + 60].replace("\n", " ")})

                for run in _CJK_RUN.findall(text):
                    # CJK segments take character n-grams (no word
                    # boundaries exist); ASCII takes whole words only,
                    # so Cooler stays Cooler and coo/ool/ole never exist.
                    for seg in re.findall(r"[\u4e00-\u9fff]+", run):
                        L = len(seg)
                        for n in SCAN_NGRAMS:
                            if n > L:
                                continue
                            for i in range(L - n + 1):
                                g = _FnNorm(seg[i:i + n])
                                _bump(g, text.find(seg[max(0, i - 1):i + n + 1][:12]))
                    for w in _ASCII_WORD.findall(run):
                        g = _FnNorm(w)
                        if len(g) < 2:
                            continue
                        # ALL-CAPS acronyms (BOM/CNC/LED): judged on raw case
                        # BEFORE lowering ate the evidence.
                        _bump(g, text.find(w),
                              skip_junk=(w.isupper() and 2 <= len(w) <= 6))
    scored = []
    for g, d in df.items():
        if d < 2:
            continue
        t = tf.get(g, 0)
        if t < min_tf:
            continue
        # Score: DF dominates, longer CJK terms get a strong bonus so
        # rare 3-8 char domain phrases (租賃合約, 水冷分配櫃) aren't
        # crowded out by 2-char generic fragments with higher raw DF.
        # Pure-ASCII lowercase fragments (ae/loo/business) get NO length
        # bonus and a flat penalty — they are almost never real domain
        # concepts. ALL-CAPS acronyms (BOM/CNC/LED) keep full score.
        if re.fullmatch(r"[a-z0-9.\-/]+", g) and g.upper() != g:
            score = d * 10 + t - 20
        else:
            ln_bonus = max(0, len(g) - 2) * 12
            score = d * 10 + t + ln_bonus
        scored.append({"term": g, "df": d, "tf": t,
                       "score": score,
                       "files": evidence.get(g, [])})
    scored.sort(key=lambda x: (-x["score"], x["term"]))
    # Cache the fresh mine (TTL + fingerprint gate the next hit).
    try:
        _MINE_CACHE[key] = {"fp": fp, "result": scored, "ts": time.time()}
    except Exception:
        pass
    return scored


def FnJudgeTerms(cands, official_names):
    """One LLM call: keep genuine domain concepts, drop generic words.

    Returns {ok, kept: [{term, reason, merge_into}], model} or {ok: False}.
    Fails CLOSED: unparsable reply inserts nothing.
    """
    from .llm_provider import FnResolveActiveLLM, FnPostJsonHardTimeout
    tgt = FnResolveActiveLLM()
    if not tgt.get("ok"):
        return {"ok": False, "error": tgt.get("error") or "no LLM provider"}
    import urllib.request
    lines = []
    for c in cands[:SCAN_TOP_JUDGE]:
        files = ",".join({f["rel"].split("/")[-1] for f in c["files"][:3]})
        lines.append("- %s (DF=%d, e.g. %s)" % (c["term"], c["df"], files))
    from .prompts import FnGetPrompt
    prompt_cfg = FnGetPrompt("concept_scan")
    cand_lines = "\n".join(lines)
    off_concepts = "、".join(official_names[:40]) or "（無）"
    template = prompt_cfg.get("template") or ""
    prompt = template.format(official_concepts=off_concepts, candidates=cand_lines)
    system_msg = prompt_cfg.get("system") or "只輸出 JSON 陣列，不要解釋。"
    payload = json.dumps({
        "model": tgt["model"],
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": prompt},
        ],
        # gpt-5 series 400s on legacy max_tokens; cap bounds decode time
        # (prefill is fast, a rambling reply is not). Truncated JSON fails
        # closed (inserts nothing), so keep the cap generous.
        "max_completion_tokens": 2000,
        # Reasoning off (measured on vine's identical judge workload):
        # default effort burns the whole completion budget thinking
        # (out=300/reasoning=300/finish=length -> empty); this curation
        # task needs zero thinking. Strip-retry below covers endpoints
        # that reject the param.
        "reasoning_effort": "none",
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if tgt.get("key"):
        headers["Authorization"] = "Bearer " + tgt["key"]
    # TOTAL deadline (same dribble rule as vine): per-recv timeout never
    # fires on a degraded endpoint, so bound the whole call at 150s.
    hr = FnPostJsonHardTimeout(tgt["base"] + "/chat/completions",
                               payload, headers, total_secs=150)
    if not hr.get("ok"):
        # Endpoint may not know reasoning_effort: strip and retry once.
        try:
            _b = json.loads(payload.decode("utf-8"))
            if isinstance(_b, dict) and "reasoning_effort" in _b:
                del _b["reasoning_effort"]
                hr = FnPostJsonHardTimeout(
                    tgt["base"] + "/chat/completions",
                    json.dumps(_b).encode("utf-8"), headers, total_secs=150)
        except Exception:
            pass
    if not hr.get("ok"):
        return {"ok": False, "error": hr.get("error") or "LLM call failed"}
    try:
        data = json.loads((hr.get("raw") or b"").decode("utf-8"))
        msg = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        m = re.search(r"\[.*\]", msg, re.S)
        if not m:
            return {"ok": False, "error": "LLM 未回傳 JSON（原文前80字：%s）" % msg[:80]}
        kept = json.loads(m.group(0))
        if not isinstance(kept, list):
            return {"ok": False, "error": "LLM 回傳非陣列"}
        return {"ok": True, "kept": kept, "model": tgt["model"]}
    except Exception as e:
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}


def FnEnsureScanTables(db_path):
    con = sqlite3.connect(db_path)
    try:
        con.execute("""
            CREATE TABLE IF NOT EXISTS rejected_terms (
                term TEXT PRIMARY KEY,
                decided_by TEXT DEFAULT '',
                decided_at TEXT NOT NULL
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS scan_evidence (
                term TEXT PRIMARY KEY,
                sources_json TEXT NOT NULL DEFAULT '[]',
                score REAL NOT NULL DEFAULT 0,
                model TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)
        # v2 columns: document/testimony counts for potential display.
        for _ddl in ("ALTER TABLE scan_evidence ADD COLUMN df INTEGER NOT NULL DEFAULT 0",
                     "ALTER TABLE scan_evidence ADD COLUMN tf INTEGER NOT NULL DEFAULT 0"):
            try:
                con.execute(_ddl)
            except Exception:
                pass
        con.commit()
    finally:
        con.close()


def _FnHasIndex(db_path):
    import sqlite3 as _sq
    try:
        if not db_path or not os.path.isfile(db_path):
            return False
        con = _sq.connect(db_path)
        try:
            row = con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='files'").fetchone()
            return bool(row)
        finally:
            con.close()
    except Exception:
        return False


def FnRecountCandidates(repo_paths, db_path):
    """Refresh DF/TF/snippets for candidates already in the pool.

    Pure CPU recount (zero tokens): reuses a fresh mining pass and UPDATEs
    existing candidate rows so their 出現N檔 stays true as the corpus grows.
    Returns {updated, total}.
    """
    import sqlite3 as _sq
    mined = FnMineCorpus(repo_paths)
    by_term = {c["term"]: c for c in mined}
    con = _sq.connect(db_path)
    updated = 0
    try:
        try:
            # NOTE: his table names the column `name`, not `term`.
            rows = con.execute(
                "SELECT name FROM concepts WHERE status='candidate'").fetchall()
        except Exception:
            rows = []
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        for (name,) in rows:
            c = by_term.get(_FnNorm(name))
            if not c:
                continue
            con.execute(
                "INSERT OR REPLACE INTO scan_evidence"
                "(term, sources_json, score, model, created_at, df, tf)"
                " VALUES(?, ?, ?, "
                "COALESCE((SELECT model FROM scan_evidence WHERE term=?), ''), ?, ?, ?)",
                (name, json.dumps(c["files"], ensure_ascii=False),
                 c["score"], name, now, c["df"], c["tf"]))
            updated += 1
        con.commit()
    finally:
        con.close()
    return {"updated": updated, "total": len(rows) if "rows" in dir() else 0}


def FnRecountOneTerm(repo_paths, db_path, term):
    """Recount DF/TF/snippets for ONE term (per-card refresh, Prospect).

    Pure CPU recount (zero tokens): same fresh mining pass as the bulk
    recount, but upserts only the requested term — even for officials
    (so their counts exist too). Returns {ok, term, df, tf, files}.
    A term below mining gates reports zeros honestly (not an error).
    """
    import sqlite3 as _sq
    term = (term or "").strip()
    if not term:
        return {"ok": False, "error": "term required"}
    FnEnsureScanTables(db_path)
    mined = FnMineCorpus(repo_paths)
    c = {x["term"]: x for x in mined}.get(_FnNorm(term))
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    con = _sq.connect(db_path)
    try:
        if c:
            con.execute(
                "INSERT OR REPLACE INTO scan_evidence"
                "(term, sources_json, score, model, created_at, df, tf)"
                " VALUES(?, ?, ?, "
                "COALESCE((SELECT model FROM scan_evidence WHERE term=?), ''), ?, ?, ?)",
                (term, json.dumps(c["files"], ensure_ascii=False),
                 c["score"], term, now, c["df"], c["tf"]))
            con.commit()
            return {"ok": True, "term": term, "df": c["df"], "tf": c["tf"],
                    "files": c["files"][:5]}
        con.execute(
            "INSERT OR REPLACE INTO scan_evidence"
            "(term, sources_json, score, model, created_at, df, tf)"
            " VALUES(?, '[]', 0, "
            "COALESCE((SELECT model FROM scan_evidence WHERE term=?), ''), ?, 0, 0)",
            (term, term, now))
        con.commit()
        return {"ok": True, "term": term, "df": 0, "tf": 0, "files": [],
                "note": "below mining gates"}
    finally:
        con.close()


def FnRunScan(repo_paths, db_path, max_new=20, min_tf=1,
             dry_run=False, exclude=None, refresh=False):
    """Full pipeline: mine -> judge -> insert candidates. Returns report dict.

    max_new caps inserted candidates per call; min_tf gates total mentions
    (a term seen fewer times is accidental, not a concept).
    dry_run=True proposes without writing anything (for review dialogs);
    exclude skips already-seen terms (continued digging).
    refresh=True forces a corpus re-mine (UI「重新掃描」鈕), bypassing the
    fingerprint+TTL cache inside FnMineCorpus.
    """
    if not _FnHasIndex(db_path):
        return {"ok": True, "mined": 0, "judged": 0, "inserted": [],
                "model": "", "note": "該庫尚未索引，先 Sync 後再掃"}
    FnEnsureScanTables(db_path)
    mined = FnMineCorpus(repo_paths, min_tf=min_tf, refresh=refresh)
    # Skip anything already decided anywhere (official/candidate/rejected).
    con = sqlite3.connect(db_path)
    try:
        try:
            known = {r[0] for r in con.execute("SELECT name FROM concepts")}
        except Exception:
            known = set()
        try:
            rej = {r[0] for r in con.execute("SELECT term FROM rejected_terms")}
        except Exception:
            rej = set()
        try:
            official = [r[0] for r in
                        con.execute("SELECT name FROM concepts WHERE status <> 'candidate'")]
        except Exception:
            official = []
    finally:
        con.close()
    ex = {_FnNorm(x) for x in (exclude or []) if x}
    fresh = [c for c in mined
             if c["term"] not in known and c["term"] not in rej
             and c["term"] not in ex][:SCAN_TOP_JUDGE]
    if not fresh:
        return {"ok": True, "mined": len(mined), "judged": 0,
                "inserted": [], "model": "", "note": "掃過全庫，沒有新面孔"}
    res = FnJudgeTerms(fresh, official)
    if not res.get("ok"):
        return {"ok": False, "error": res.get("error"), "mined": len(mined)}
    inserted = []
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    fresh_terms = {c["term"] for c in fresh}
    kept_valid = []
    for k in res["kept"][:max(1, max_new)]:
        term = _FnNorm(k.get("term") if isinstance(k, dict) else k)
        # The judge may only pick from the shortlist: hallucinated
        # terms outside `fresh` are dropped, never inserted.
        if term not in fresh_terms:
            continue
        if _FnIsJunk(term) or term in known or term in rej or term in ex:
            continue
        ev = next((c for c in fresh if c["term"] == term), None)
        kept_valid.append((term, k, ev))
    if dry_run:
        # Propose only: zero writes, same response shape for review UI.
        for term, k, ev in kept_valid:
            inserted.append({"term": term,
                             "reason": (k.get("reason") if isinstance(k, dict) else "") or "",
                             "merge_into": (k.get("merge_into") if isinstance(k, dict) else "") or "",
                             "df": (ev or {}).get("df", 0),
                             "tf": (ev or {}).get("tf", 0),
                             "files": (ev or {}).get("files", [])})
        return {"ok": True, "mined": len(mined), "judged": len(fresh),
                "inserted": inserted, "model": res.get("model", ""),
                "persisted": False}
    con = sqlite3.connect(db_path)
    try:
        for term, k, ev in kept_valid:
            try:
                con.execute(
                    "INSERT OR IGNORE INTO concepts(name, category, aliases, status, created_at)"
                    " VALUES(?, '機器挖掘', '', 'candidate', ?)", (term, now))
                con.execute(
                    "INSERT OR REPLACE INTO scan_evidence(term, sources_json, score, model, created_at, df, tf)"
                    " VALUES(?, ?, ?, ?, ?, ?, ?)",
                    (term, json.dumps((ev or {}).get("files", []), ensure_ascii=False),
                     (ev or {}).get("score", 0), res.get("model", ""), now,
                     (ev or {}).get("df", 0), (ev or {}).get("tf", 0)))
                inserted.append({"term": term,
                                 "reason": (k.get("reason") if isinstance(k, dict) else "") or "",
                                 "merge_into": (k.get("merge_into") if isinstance(k, dict) else "") or "",
                                 "df": (ev or {}).get("df", 0),
                                 "tf": (ev or {}).get("tf", 0),
                                 "files": (ev or {}).get("files", [])})
            except Exception:
                continue
        con.commit()
    finally:
        con.close()
    return {"ok": True, "mined": len(mined), "judged": len(fresh),
            "inserted": inserted, "model": res.get("model", ""),
            "persisted": True}
