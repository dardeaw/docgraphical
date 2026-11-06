# -*- coding: utf-8 -*-
"""docgraphical.pipeline
Unified Concept Discovery & Maintenance Pipeline.

Modularized and decoupled engine governing:
1. Prospect Pipeline (CPU Mining & Recount)
2. Vine Pipeline (Goal-Seeking Deep Crawl with Quota Fulfillment)
3. Canonical Link & Edge Synchronization (Surgical Unlink & Zero-Phantom Attach)
"""
import os
import re
import time
import json
import sqlite3
from typing import List, Dict, Any, Optional, Set, Tuple


def get_concept_metrics(con: sqlite3.Connection, concept_name: str) -> Dict[str, int]:
    """Return both distinct document count (doc_count) and distinct section references (ref_count)."""
    clean_name = (concept_name or "").strip()
    cid = f"concept::{clean_name}"
    cur = con.cursor()
    cur.execute("""
        SELECT DISTINCT source
        FROM edges
        WHERE kind = 'wiki_link' AND (target = ? OR target = ?)
    """, (cid, clean_name))
    sources = [r[0] for r in cur.fetchall()]
    
    docs = set()
    for s in sources:
        clean = s.replace("heading::", "").replace("file::", "").split("::")[0].strip()
        if clean:
            docs.add(clean.replace("\\", "/"))

    return {
        "doc_count": len(docs),
        "ref_count": len(sources)
    }


def get_linked_section_signatures(con: sqlite3.Connection, concept_name: str) -> Set[Any]:
    """Retrieve existing linked section signatures for strict deduplication."""
    clean_name = (concept_name or "").strip()
    cid = f"concept::{clean_name}"
    cur = con.cursor()
    cur.execute("""
        SELECT DISTINCT source
        FROM edges
        WHERE kind = 'wiki_link' AND (target = ? OR target = ?)
    """, (cid, clean_name))
    
    sigs = set()
    for (s_id,) in cur.fetchall():
        sid_raw = (s_id or "").strip()
        if not sid_raw:
            continue
        sigs.add(sid_raw)
        clean_f = sid_raw.replace("heading::", "").replace("file::", "").split("::")[0].strip().replace("\\", "/")
        if clean_f:
            sigs.add(clean_f)
            sigs.add(os.path.basename(clean_f))
        if sid_raw.startswith("heading::") and "::" in sid_raw[9:]:
            parts = sid_raw[9:].split("::")
            if len(parts) >= 3:
                f_part = parts[0].replace("\\", "/")
                h_part = "::".join(parts[2:]).strip()
                sigs.add((f_part, h_part))
                sigs.add((os.path.basename(f_part), h_part))
            elif len(parts) == 2:
                f_part = parts[0].replace("\\", "/")
                h_part = parts[1].strip()
                sigs.add((f_part, h_part))
                sigs.add((os.path.basename(f_part), h_part))
    return sigs


def is_already_linked(file_rel: str, heading: str, signatures: Set[Any]) -> bool:
    """Check if a file or specific section is already linked to the concept."""
    f_clean = file_rel.replace("\\", "/").strip()
    f_base = os.path.basename(f_clean)
    h_clean = (heading or "").strip()

    if not h_clean:
        return (f_clean in signatures or f_base in signatures)
    
    if (f_clean, h_clean) in signatures or (f_base, h_clean) in signatures:
        return True
    if f"heading::{f_clean}::{h_clean}" in signatures or f"heading::{f_base}::{h_clean}" in signatures:
        return True
    return False


def run_vine_pipeline(repo_path: str, concept_name: str, target_quota: int = 20, max_walk_files: int = 30) -> Dict[str, Any]:
    """Execute Vine deep crawl with goal-seeking quota fulfillment and duplicate exclusion.
    
    Keeps traversing neighbours until either:
    1. target_quota (e.g. 20) newly unlinked candidate sections are discovered, or
    2. all relevant walk paths are exhausted.
    """
    from .db import get_db_path
    from .crawl import FnCrawlStart, FnCrawlNext, FnCrawlFinish, _is_doc_file, _RUNS

    name = (concept_name or "").strip()
    repo = os.path.abspath(repo_path)
    db_path = get_db_path(repo)
    if not db_path or not os.path.isfile(db_path):
        return {"ok": False, "error": f"Database not found for {repo}"}

    con = sqlite3.connect(db_path)
    try:
        signatures = get_linked_section_signatures(con, name)
        metrics = get_concept_metrics(con, name)
    finally:
        con.close()

    new_items = []
    seen_keys = set()
    spent_total = 0

    st = FnCrawlStart(repo, seed_text=name, max_starts=5)
    if not st.get("ok"):
        return {"ok": False, "error": st.get("error") or "Vine start failed"}
    
    run_id = st["run_id"]
    spent_total += 1

    walked_files = 0
    max_steps = max(10, max_walk_files * 2)

    for _ in range(max_steps):
        if len(new_items) >= target_quota:
            break

        nx = FnCrawlNext(run_id, max_files=max_walk_files)
        if not nx.get("ok"):
            break
        if nx.get("kind") == "file":
            walked_files += 1

        if nx.get("done"):
            break

    fin = FnCrawlFinish(run_id)
    spent_total += fin.get("spent", 0)
    raw_kept = fin.get("kept") or []

    for k in raw_kept:
        f = (k or {}).get("file")
        m = (k or {}).get("term")
        h = (k or {}).get("heading") or ""
        if not f or not m or not _is_doc_file(f):
            continue
        
        target_key = f"{f}::{h}" if h else f
        if target_key in seen_keys:
            continue
        
        # Check against existing knowledge base links
        if is_already_linked(f, h, signatures):
            continue

        seen_keys.add(target_key)
        new_items.append(k)
        if len(new_items) >= target_quota:
            break

    return {
        "ok": True,
        "title": name,
        "quota": target_quota,
        "added": len(new_items),
        "new_items": new_items,
        "all_items": raw_kept,
        "existing_count": metrics["ref_count"],
        "existing_docs": metrics["doc_count"],
        "spent": spent_total,
        "walked_files": walked_files
    }


def scan_candidate_sections(repo_path: str, rel_file: str, terms: List[str], signatures: Set[Any]) -> List[Dict[str, Any]]:
    """Scan a markdown document and extract matching sections at md, h1, h2, h3+ levels."""
    full = os.path.join(repo_path, rel_file)
    try:
        with open(full, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except Exception:
        return []

    sections = []
    clean_f = rel_file.replace("\\", "/").strip()
    file_text = "".join(lines)
    
    # 1. Level 0: md file root
    hit_terms = [t for t in terms if t.lower() in file_text.lower()]
    if hit_terms:
        t0 = hit_terms[0]
        pos = file_text.lower().find(t0.lower())
        s0 = max(0, pos - 20)
        snippet = file_text[s0:s0 + 60].replace("\n", " ").strip()
        ref_id = f"file::{clean_f}"
        sections.append({
            "file": clean_f,
            "rel": clean_f,
            "heading": "",
            "line": 1,
            "level": 0,
            "type": "md",
            "snippet": snippet,
            "refId": ref_id,
            "already_linked": is_already_linked(clean_f, "", signatures)
        })

    # 2. Markdown Headings (H1, H2, H3, ...)
    heading_re = re.compile(r"^(#{1,6})\s+(.*)$")
    cur_heading = None
    cur_level = 0
    cur_line = 1
    cur_lines = []

    def flush(h_title, h_lvl, h_ln, h_body):
        body_text = "".join(h_body)
        matched = [t for t in terms if t.lower() in (h_title.lower() + " " + body_text.lower())]
        if matched:
            t0 = matched[0]
            combined = h_title + "\n" + body_text
            pos = combined.lower().find(t0.lower())
            s0 = max(0, pos - 20)
            snip = combined[s0:s0 + 60].replace("\n", " ").strip()
            type_tag = f"h{h_lvl}" if h_lvl <= 6 else "heading"
            ref_id = f"heading::{clean_f}::L{h_ln}::{h_title}"
            sections.append({
                "file": clean_f,
                "rel": clean_f,
                "heading": h_title,
                "line": h_ln,
                "level": h_lvl,
                "type": type_tag,
                "snippet": snip,
                "refId": ref_id,
                "already_linked": is_already_linked(clean_f, h_title, signatures)
            })

    for idx, line in enumerate(lines, 1):
        m = heading_re.match(line.strip())
        if m:
            if cur_heading is not None:
                flush(cur_heading, cur_level, cur_line, cur_lines)
            hashes, title = m.groups()
            cur_heading = title.strip()
            cur_level = len(hashes)
            cur_line = idx
            cur_lines = []
        else:
            if cur_heading is not None:
                cur_lines.append(line)

    if cur_heading is not None:
        flush(cur_heading, cur_level, cur_line, cur_lines)

    return sections


def run_prospect_pipeline(repo_paths: List[str], db_path: str, concept_name: str, target_quota: int = 20) -> Dict[str, Any]:
    """Execute Prospect recount for a single concept with hierarchical section discovery (md -> h1 -> h2)."""
    from .concept_scan import FnRecountOneTerm, FnMineCorpus, _FnNorm

    name = (concept_name or "").strip()
    res = FnRecountOneTerm(repo_paths, db_path, name)
    if not res.get("ok"):
        return res

    con = sqlite3.connect(db_path)
    try:
        metrics = get_concept_metrics(con, name)
        sigs = get_linked_section_signatures(con, name)
    finally:
        con.close()

    # Query aliases from concepts table
    aliases = []
    con_a = sqlite3.connect(db_path)
    try:
        row_a = con_a.execute("SELECT aliases FROM concepts WHERE name = ?", (name,)).fetchone()
        if row_a and row_a[0]:
            aliases = [a.strip() for a in row_a[0].split(",") if a.strip()]
    finally:
        con_a.close()

    terms_to_check = [name] + aliases
    if not terms_to_check:
        terms_to_check = [name]

    # Find all relevant files across repos
    mined = FnMineCorpus(repo_paths, refresh=True)
    mined_map = {x["term"]: x for x in mined}

    matched_rel_files = set()
    for t_raw in terms_to_check:
        t_norm = _FnNorm(t_raw)
        c = mined_map.get(t_norm)
        if c and c.get("files"):
            for f_item in c["files"]:
                f_rel = (f_item.get("rel") or "").replace("\\", "/").strip()
                f_base = os.path.basename(f_rel)
                f_low = f_base.lower()
                if f_low in ("doc_catalog.md", "log.md") or ".docgraph" in f_rel.lower():
                    continue
                matched_rel_files.add(f_rel)

    # Scan sections for all matching files
    primary_repo = repo_paths[0] if repo_paths else ""
    all_sections = []
    for f_rel in sorted(matched_rel_files):
        # Locate file on disk
        f_repo = primary_repo
        for rp in repo_paths:
            if os.path.isfile(os.path.join(rp, f_rel)):
                f_repo = rp
                break
        sec_list = scan_candidate_sections(f_repo, f_rel, terms_to_check, sigs)
        all_sections.extend(sec_list)

    # Separate unlinked vs already linked
    unlinked_candidates = [s for s in all_sections if not s.get("already_linked")]
    linked_candidates = [s for s in all_sections if s.get("already_linked")]

    # Hierarchical sort order: level ascending (0=md, 1=h1, 2=h2, 3=h3), then file path, then line number
    unlinked_candidates.sort(key=lambda x: (x.get("level", 99), x.get("file", ""), x.get("line", 0)))

    # Cap unlinked candidates by target_quota (default 20)
    capped_unlinked = unlinked_candidates[:target_quota]

    # Combined candidate list for review dialog
    final_candidates = capped_unlinked + [s for s in linked_candidates if s.get("level") == 0]

    return {
        "ok": True,
        "term": name,
        "quota": target_quota,
        "df": res.get("df", 0),
        "tf": res.get("tf", 0),
        "files": capped_unlinked,
        "all_sections": all_sections,
        "unlinked_files": capped_unlinked,
        "total_unlinked": len(unlinked_candidates),
        "total_corpus": len(all_sections),
        "existing_count": metrics["ref_count"],
        "existing_docs": metrics["doc_count"]
    }

