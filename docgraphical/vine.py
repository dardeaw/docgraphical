# -*- coding: utf-8 -*-
"""Vine walking: guided graph traversal shared by concept discovery and
future knowledge retrieval. (VINE_WALKING.md V2)

Discipline:
- CPU walks tables only (Map/Neighbors/Walk). No text similarity here.
- LLM answers exactly one question per call via FnVineGuide (route choice).
  It judges options the CPU built; it never invents new nodes.
- visited lives inside the walk: callers may pass some in, walk returns
  the grown set. Callers never decide what to remember.
- Blacklisted terms never appear on any map or junction, period.
"""
import os
import sqlite3

WIKI_KINDS = ("wiki_link",)
WALK_MAX_DEPTH = 2
WALK_TOP_N = 20


def _connect(db_path):
    if not db_path or not os.path.isfile(db_path):
        return None
    try:
        return sqlite3.connect(db_path)
    except Exception:
        return None


def _tables(con):
    try:
        return {r[0] for r in
                con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    except Exception:
        return set()


def _concepts(con):
    """{name: {status, category, aliases}} — empty when table missing."""
    out = {}
    try:
        for name, cat, als, status in con.execute(
                "SELECT name, category, aliases, status FROM concepts"):
            out[name] = {"status": status or "official",
                         "category": cat or "",
                         "aliases": als or ""}
    except Exception:
        pass
    return out


def _blacklist(con):
    try:
        return {r[0] for r in con.execute("SELECT term FROM rejected_terms")}
    except Exception:
        return set()


def _canon(name, concepts, con=None):
    """Resolve alias surface form to canonical concept name (or None).

    Registry first; a term merely MENTIONED ([[x]] in some file) still
    counts via its concept::x node — walkable, status unknown.
    """
    if not name:
        return None
    if name in concepts:
        return name
    low = name.strip().lower()
    for canon, info in concepts.items():
        if canon.strip().lower() == low:
            return canon
        for a in (info.get("aliases") or "").replace("、", ",").split(","):
            if a.strip() and a.strip().lower() == low:
                return canon
    if con is not None:
        try:
            row = con.execute(
                "SELECT id FROM nodes WHERE id IN (?, ?)",
                ("concept::" + name.strip(), name.strip())).fetchone()
            if row:
                return name.strip()
        except Exception:
            pass
    return None


def _source_file(con, src):
    """Resolve an edge source id to its file path.

    The parser links heading->concept, so wiki_link sources are usually
    heading ids; climb one parent_child rung up to the file.
    Returns '' when unresolvable.
    """
    if not src:
        return ""
    if src.startswith("file::"):
        return src[len("file::"):]
    try:
        row = con.execute(
            "SELECT source FROM edges WHERE target = ? AND kind = 'parent_child'"
            " ORDER BY source LIMIT 1", (src,)).fetchone()
        if row and row[0] and row[0].startswith("file::"):
            return row[0][len("file::"):]
    except Exception:
        pass
    return ""


def FnVineMap(db_path):
    """Whole-map overview for the guide: files x concepts + inventories.

    Returns {ok, files: [{path, concepts: [names]}], official: [...],
    candidates: [...], counts}. Blacklist never listed.
    """
    con = _connect(db_path)
    if con is None:
        return {"ok": False, "error": "database not found: %s" % db_path}
    try:
        concepts = _concepts(con)
        bl = _blacklist(con)
        file_concepts = {}
        try:
            rows = con.execute(
                "SELECT source, target FROM edges WHERE kind = 'wiki_link'").fetchall()
        except Exception:
            rows = []
        for src, tgt in rows:
            cname = (tgt or "")
            if cname.startswith("concept::"):
                cname = cname[len("concept::"):]
            cname = _canon(cname, concepts, con) or cname
            if cname in bl:
                continue
            fpath = _source_file(con, src or "")
            if not fpath:
                continue
            file_concepts.setdefault(fpath, set()).add(cname)
        files = [{"path": p, "concepts": sorted(v)}
                 for p, v in sorted(file_concepts.items())]
        ref_counts = {}
        for p, names in file_concepts.items():
            for n in names:
                ref_counts[n] = ref_counts.get(n, 0) + 1
        official, candidates = [], []
        for n, info in sorted(concepts.items()):
            if n in bl:
                continue
            row = {"name": n, "refs": ref_counts.get(n, 0),
                   "category": info.get("category", "")}
            (official if info.get("status") != "candidate" else candidates).append(row)
        return {"ok": True, "files": files, "official": official,
                "candidates": candidates,
                "counts": {"files": len(files), "official": len(official),
                           "candidates": len(candidates)}}
    finally:
        con.close()


def _node_rows(con, ids):
    """{node id: {kind, name, snippet}} for evidence (snippet = 200 chars)."""
    if not ids:
        return {}
    try:
        ph = ",".join("?" for _ in ids)
        out = {}
        for i, k, n, c in con.execute(
                "SELECT id, kind, name, content FROM nodes WHERE id IN (%s)" % ph,
                list(ids)):
            out[i] = {"kind": k, "name": n,
                      "snippet": ((c or "").replace("\n", " ")[:200])}
        return out
    except Exception:
        return {}


def _node_kinds(con, ids):
    if not ids:
        return {}
    try:
        ph = ",".join("?" for _ in ids)
        return {r[0]: r[1] for r in con.execute(
            "SELECT id, kind FROM nodes WHERE id IN (%s)" % ph, list(ids))}
    except Exception:
        return {}


def FnVineNeighbors(db_path, seed):
    """One-hop neighborhood of a concept name or file path.

    Returns {ok, kind: 'concept'|'file', seed,
             files: [{path, via, line}], concepts: [{name, status, via}]}.
    wiki_link kinds first, then doc_link; Top 20 each; blacklist excluded.
    """
    con = _connect(db_path)
    if con is None:
        return {"ok": False, "error": "database not found: %s" % db_path}
    files, co, headings = [], [], []
    seen_f, seen_c, seen_h = set(), set(), set()
    try:
        concepts = _concepts(con)
        bl = _blacklist(con)
        seed = (seed or "").strip()
        canon = _canon(seed, concepts, con)
        if canon is not None:
            kind, cname = "concept", canon
        else:
            kind, cname = "file", seed
        try:
            if kind == "concept":
                cids = {"concept::" + cname, cname}
                q = ("SELECT source, target, kind, line FROM edges"
                     " WHERE (target = ? OR target = ?)"
                     " ORDER BY CASE kind WHEN 'wiki_link' THEN 0 ELSE 1 END")
                rows = con.execute(q, ("concept::" + cname, cname)).fetchall()
                # Sources are usually HEADING ids (the parser links
                # heading->concept): climb to their files for the file
                # list, but keep the raw ids for co-concepts below.
                src_rows = [(s or "", ek, ln) for s, _t, ek, ln in rows if s]
                for src, ekind, line in src_rows:
                    fpath = _source_file(con, src)
                    if fpath and fpath not in seen_f and len(files) < WALK_TOP_N:
                        seen_f.add(fpath)
                        files.append({"path": fpath, "via": ekind, "line": line,
                                      "snippet": ""})
                # Mention sweep: files whose CONTENT names the concept are
                # implicit neighbors. Plain-text mentions never become
                # edges (only bracket links do), so without this a tag
                # seed starves: 0 neighbors, 0 files, empty round - even
                # when the whole library talks about it.
                if len(files) < WALK_TOP_N:
                    try:
                        esc2 = cname.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                        mrows = con.execute(
                            "SELECT id FROM nodes WHERE kind = 'file'"
                            " AND content LIKE ? ESCAPE '\\'",
                            ("%" + esc2 + "%",)).fetchall()
                    except Exception:
                        mrows = []
                    for (fid,) in mrows:
                        p = (fid or "")
                        if p.startswith("file::"):
                            p = p[len("file::"):]
                        if p and p not in seen_f and len(files) < WALK_TOP_N:
                            seen_f.add(p)
                            files.append({"path": p, "via": "mention",
                                          "line": 0, "snippet": ""})
                if seen_f:
                    _snip = _node_rows(con, {"file::" + p for p in seen_f})
                    for f in files:
                        f["snippet"] = _snip.get("file::" + f["path"], {}).get("snippet", "")
                # Co-concepts: other concepts sharing those sources
                # (file-level edges, or their headings in current schema).
                if src_rows:
                    sids = [s for s, _e, _l in src_rows]
                    try:
                        qrows = con.execute(
                            "SELECT target, line, source FROM edges WHERE kind = 'wiki_link'"
                            " AND source IN (%s)" % ",".join("?" for _ in sids),
                            sids).fetchall()
                    except Exception:
                        qrows = []
                    line_of, file_of = {}, {}
                    for t2, ln2, s2 in qrows:
                        n2 = (t2 or "")
                        if n2.startswith("concept::"):
                            n2 = n2[len("concept::"):]
                        n2 = _canon(n2, concepts, con) or n2
                        if n2 and n2 != cname and n2 not in bl and n2 not in seen_c \
                                and len(co) < WALK_TOP_N:
                            seen_c.add(n2)
                            line_of.setdefault(n2, ln2)
                            file_of.setdefault(n2, _source_file(con, s2 or ""))
                            st = concepts.get(n2, {}).get("status", "unknown")
                            co.append({"name": n2, "status": st, "via": "co-file",
                                       "line": line_of[n2], "efile": file_of[n2]})
            else:
                # File mode: ALL edge kinds offered (wiki_link, doc_link,
                # parent_child) with kind labels; LLM judges which to take.
                # Headings ride along as walk options (with section preview)
                # but can NEVER become newcomers (see Walk filter).
                fids = {"file::" + cname, cname}
                rows = con.execute(
                    "SELECT source, target, kind, line FROM edges"
                    " WHERE (source = ? OR source = ?)"
                    " ORDER BY CASE kind WHEN 'wiki_link' THEN 0"
                    " WHEN 'doc_link' THEN 1 ELSE 2 END",
                    ("file::" + cname, cname)).fetchall()
                info = _node_rows(con, {t for _, t, _, _ in rows})
                if not rows:
                    # Fallback: seed may be a heading title — resolve its
                    # node ids, then walk their out-edges the same way.
                    try:
                        hids = [r[0] for r in con.execute(
                            "SELECT id FROM nodes WHERE kind LIKE 'heading%'"
                            " AND (name = ? OR id = ?)", (cname, cname)).fetchall()]
                    except Exception:
                        hids = []
                    if hids:
                        ph = ",".join("?" for _ in hids)
                        rows = con.execute(
                            "SELECT source, target, kind, line FROM edges"
                            " WHERE source IN (%s)"
                            " ORDER BY CASE kind WHEN 'wiki_link' THEN 0"
                            " WHEN 'doc_link' THEN 1 ELSE 2 END" % ph,
                            hids).fetchall()
                        info = _node_rows(con, {t for _, t, _, _ in rows})
                for src, tgt, ekind, line in rows:
                    ni = info.get(tgt, {})
                    nkind = ni.get("kind", "")
                    if nkind not in ("concept", "file") and not nkind.startswith("heading"):
                        continue
                    n2 = (tgt or "")
                    if n2.startswith("concept::"):
                        n2 = n2[len("concept::"):]
                    elif n2.startswith("file::"):
                        n2 = n2[len("file::"):]
                    elif nkind.startswith("heading"):
                        n2 = ni.get("name", "") or n2
                    else:
                        continue
                    n2 = _canon(n2, concepts, con) or n2
                    if not n2 or n2 in bl:
                        continue
                    if nkind.startswith("heading"):
                        if len(headings) < WALK_TOP_N and tgt not in seen_h:
                            seen_h.add(tgt)
                            headings.append({"name": n2, "node": nkind, "via": ekind,
                                             "line": line, "snippet": ni.get("snippet", "")})
                        continue
                    if n2 not in seen_c and len(co) < WALK_TOP_N:
                        seen_c.add(n2)
                        st = concepts.get(n2, {}).get("status", "unknown")
                        co.append({"name": n2, "status": st, "via": ekind, "line": line,
                                   "node": nkind,
                                   "efile": _source_file(con, src or "") or cname})
        except Exception:
            pass
        return {"ok": True, "kind": kind, "seed": cname,
                "files": files, "concepts": co, "headings": headings}
    finally:
        con.close()


def FnResolveSeed(db_path, seed):
    """Turn a human keyword into walkable start node(s).

    Resolution order: exact concept (registry/alias/mentioned) ->
    concept substring -> file text hit (walk starts FROM those files).
    Returns {ok, seed, starts: [{kind: 'concept'|'file', id}], note}.
    """
    seed = (seed or "").strip()
    if not seed:
        return {"ok": False, "error": "empty seed"}
    con = _connect(db_path)
    if con is None:
        return {"ok": False, "error": "database not found: %s" % db_path}
    try:
        concepts = _concepts(con)
        bl = _blacklist(con)
        canon = _canon(seed, concepts, con)
        if canon and canon not in bl:
            return {"ok": True, "seed": seed,
                    "starts": [{"kind": "concept", "id": canon}],
                    "note": "exact concept"}
        esc = seed.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        starts, seen = [], set()
        # Concept substring: registry names + mentioned [[x]] nodes.
        try:
            for (nm,) in con.execute(
                    "SELECT name FROM concepts WHERE name LIKE ? ESCAPE '\\'",
                    ("%" + esc + "%",)).fetchall():
                if nm and nm not in bl and nm not in seen and len(starts) < 5:
                    seen.add(nm)
                    starts.append({"kind": "concept", "id": nm})
            for (nid,) in con.execute(
                    "SELECT id FROM nodes WHERE id LIKE ? ESCAPE '\\'",
                    ("concept::%" + esc + "%",)).fetchall():
                nm = nid[len("concept::"):]
                if nm and nm not in bl and nm not in seen and len(starts) < 5:
                    seen.add(nm)
                    starts.append({"kind": "concept", "id": nm})
        except Exception:
            pass
        if starts:
            return {"ok": True, "seed": seed, "starts": starts,
                    "note": "concept substring (%d)" % len(starts)}
        # File text hit: files whose content contains the seed.
        try:
            rows = con.execute(
                "SELECT id FROM nodes WHERE id LIKE 'file::%'"
                " AND content LIKE ? ESCAPE '\\' LIMIT 5",
                ("%" + esc + "%",)).fetchall()
        except Exception:
            rows = []
        for (fid,) in rows:
            p = fid[len("file::"):]
            if p and p not in seen:
                seen.add(p)
                starts.append({"kind": "file", "id": p})
        if starts:
            return {"ok": True, "seed": seed, "starts": starts,
                    "note": "found in %d file(s), walking from files" % len(starts)}
        return {"ok": True, "seed": seed, "starts": [],
                "note": "no concept or file mentions '%s'" % seed}
    finally:
        con.close()


def FnVineWalk(db_path, seed, depth=1, visited=None):
    """Walk from seed up to depth (clamped 1..2), collecting newcomers.

    newcomers = encountered concepts in NO registry/blacklist, with
    evidence (file + line). visited grows inside and is returned.
    Returns {ok, seed, depth, path: [...visited in order...],
             newcomers: [{name, via, file, line}]}.
    """
    depth = max(1, min(WALK_MAX_DEPTH, int(depth or 1)))
    seen = set(visited or [])
    path = []
    newcomers = []
    seen_new = set()
    frontier = [(("file" if seed.startswith("file::") else "concept"),
                 seed[len("file::"):] if seed.startswith("file::") else seed)]
    for _ in range(depth + 1):
        nxt = []
        for kind0, s in frontier:
            key = (kind0, s)
            if key in seen:
                continue
            seen.add(key)
            path.append(s)
            nb = FnVineNeighbors(db_path, s)
            if not nb.get("ok"):
                continue
            for f in nb.get("files", []):
                fk = ("file", f["path"])
                if fk not in seen:
                    nxt.append(("file", f["path"]))
            for h in nb.get("headings", []):
                hk = ("heading", h["name"])
                if hk not in seen:
                    nxt.append(hk)
            for c in nb.get("concepts", []):
                is_file = (c.get("node") == "file")
                ck = ("file", c["name"]) if is_file else ("concept", c["name"])
                if ck in seen:
                    continue
                nxt.append(ck)
                if not is_file and c.get("status") == "unknown" and c["name"] not in seen_new:
                    seen_new.add(c["name"])
                    ev_file = (s if key[0] == "file"
                               else (c.get("efile") or ""))
                    ev_files = [f["path"] for f in nb.get("files", [])]
                    newcomers.append({"name": c["name"], "via": c.get("via", ""),
                                      "file": ev_file or (ev_files[0] if ev_files else ""),
                                      "line": c.get("line")})
        frontier = nxt
        if not frontier:
            break
    return {"ok": True, "seed": seed, "depth": depth, "path": path,
            "newcomers": newcomers[:WALK_TOP_N], "visited": sorted(
                "%s::%s" % (k, v) for k, v in seen)}


def FnVineGuide(messages, max_tokens=None):
    """The ONE route-planning caller for the whole station.

    messages: OpenAI chat messages (caller composes prompts; CPU builds
    every option list). Returns {ok, text, model} or {ok: False, error}.
    No temperature (house rule: temperature=1 only, so omit it).
    max_tokens: completion cap. Sent as max_completion_tokens (gpt-5
    series 400s on legacy max_tokens). Uncapped by default: a rambling
    model can stew minutes per call while res.read() blocks, so every
    line-protocol caller SHOULD pass a cap sized to its expected rows.
    """
    from .llm_provider import FnResolveActiveLLM, FnPostJsonHardTimeout
    tgt = FnResolveActiveLLM()
    if not tgt.get("ok"):
        return {"ok": False, "error": tgt.get("error") or "no LLM provider"}
    import json
    body = {
        "model": tgt["model"],
        "messages": messages,
    }
    # Reasoning off (measured): the default effort burns the ENTIRE
    # completion budget on reasoning tokens before emitting a line
    # (probe: out=300/reasoning=300/finish=length -> empty reply); low
    # still rambles. Vine's judge is copy-and-pick work, zero thinking
    # needed: none => reasoning=0, correct output, ~4x faster per call.
    # Non-reasoning endpoints that reject the param get one retry with
    # it stripped (same insurance pattern as max_completion_tokens).
    body["reasoning_effort"] = "none"
    if max_tokens:
        # gpt-5 series: legacy max_tokens -> 400. Cap here bounds decode
        # time (prefill is fast; a rambling multi-K-token reply is not).
        try:
            body["max_completion_tokens"] = max(1, int(max_tokens))
        except Exception:
            pass
    payload = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if tgt.get("key"):
        headers["Authorization"] = "Bearer " + tgt["key"]
    # TOTAL deadline 150s: urllib's own timeout is per-recv and never
    # fires on a dribbling endpoint (the 5-min hang). On expiry the crawl
    # skips the batch and moves on instead of dying with it.
    hr = FnPostJsonHardTimeout(tgt["base"] + "/chat/completions",
                               payload, headers, total_secs=150)
    if not hr.get("ok") and "reasoning_effort" in body:
        # Endpoint may not know the param (400/unknown-field). Strip and
        # retry once so old providers keep working exactly as before.
        try:
            import json as _json
            _b = _json.loads(payload.decode("utf-8"))
            if isinstance(_b, dict) and "reasoning_effort" in _b:
                del _b["reasoning_effort"]
                payload = _json.dumps(_b).encode("utf-8")
                hr = FnPostJsonHardTimeout(tgt["base"] + "/chat/completions",
                                           payload, headers, total_secs=150)
        except Exception:
            pass
    if not hr.get("ok"):
        return {"ok": False, "error": hr.get("error") or "LLM call failed"}
    try:
        data = json.loads((hr.get("raw") or b"").decode("utf-8"))
    except Exception as e:
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
    msg = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    if not msg:
        # Empty autopsy: distinguish cut-off (length: reasoning ate the
        # budget, raise the cap) from refusal/glitch (stop + ~0 tokens).
        # gpt-5.6-luna spends reasoning tokens on complex prompts.
        try:
            _ch0 = (data.get("choices") or [{}])[0]
            _u = data.get("usage") or {}
            _det = _u.get("completion_tokens_details") or {}
            _why = "finish=%s out=%s reasoning=%s" % (
                _ch0.get("finish_reason"), _u.get("completion_tokens"),
                _det.get("reasoning_tokens"))
        except Exception:
            _why = "unknown"
        return {"ok": False, "error": "LLM 回傳為空（%s）" % _why}
    return {"ok": True, "text": msg, "model": tgt["model"],
            "provider": tgt.get("provider")}
