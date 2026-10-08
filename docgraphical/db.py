"""DocGraphical SQLite Indexing & Graph Storage Engine.
Stores Markdown files, heading AST nodes, cross-document links, and FTS fulltext search
inside <project_root>/.docgraphical/docgraphical.db.
"""

from __future__ import annotations
import time
import urllib.parse

import hashlib
import math
import os
import re
import datetime
import sqlite3
from typing import Any, Dict, List, Optional, Tuple
from .constants import IGNORE_DIRS, DOC_EXTS
from .parser import extract_wikilinks

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    content_hash TEXT,
    size INTEGER,
    modified_at REAL,
    node_count INTEGER
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    file_path TEXT,
    kind TEXT,            -- 'file', 'heading_1', 'heading_2', 'heading_3', 'code_block'
    name TEXT,
    level INTEGER,
    start_line INTEGER,
    end_line INTEGER,
    token_estimate INTEGER,
    content TEXT,
    FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source TEXT,
    target TEXT,
    kind TEXT,            -- 'contains', 'parent_child', 'doc_link'
    line INTEGER,
    FOREIGN KEY(source) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    action TEXT NOT NULL,
    target_file TEXT,
    source_material TEXT,
    summary TEXT
);

CREATE TABLE IF NOT EXISTS concepts (
    name TEXT PRIMARY KEY,
    category TEXT DEFAULT '未分類',
    aliases TEXT DEFAULT '',
    status TEXT DEFAULT 'official',  -- 'official' or 'candidate'
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS concept_exclusions (
    concept_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (concept_name, file_path)
);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id UNINDEXED,
    name,
    content,
    tokenize = 'porter unicode61'
);
"""


def get_db_path(repo_path: str) -> str:
    repo_path = os.path.abspath(repo_path)
    for candidate in [
        os.path.join(repo_path, ".docgraphical", "docgraphical.db"),
        os.path.join(repo_path, ".docgraph", "docgraph.db"),
        os.path.join(repo_path, ".docgraphical", "docgraph.db"),
        os.path.join(repo_path, ".docgraph", "docgraphical.db"),
    ]:
        if os.path.exists(candidate):
            return candidate
    dot_dir = os.path.join(repo_path, ".docgraphical")
    os.makedirs(dot_dir, exist_ok=True)
    return os.path.join(dot_dir, "docgraphical.db")


def init_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    return conn


def compute_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()


def _FnExistingDbPath(repo_path: str) -> Optional[str]:
    """Return the existing DB path without creating anything (None = no index)."""
    repo_path = os.path.abspath(repo_path)
    for candidate in [
        os.path.join(repo_path, ".docgraphical", "docgraphical.db"),
        os.path.join(repo_path, ".docgraph", "docgraph.db"),
        os.path.join(repo_path, ".docgraphical", "docgraph.db"),
        os.path.join(repo_path, ".docgraph", "docgraphical.db"),
    ]:
        if os.path.exists(candidate):
            return candidate
    return None


def _FnWalkDocFiles(repo_path: str) -> List[str]:
    md_files: List[str] = []
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]
        for f in files:
            if f.upper() == "LOG.MD" and os.path.abspath(root) == os.path.abspath(repo_path):
                continue
            if f.lower().endswith(DOC_EXTS):
                md_files.append(os.path.join(root, f))
    return md_files


def _FnDeleteFileRows(cur: sqlite3.Connection, rel_path: str) -> None:
    """Remove every row belonging to one document (nodes/fts/files/its edges)."""
    cur.execute("SELECT id FROM nodes WHERE file_path = ?", (rel_path,))
    vIds = [r[0] for r in cur.fetchall()]
    for i in range(0, len(vIds), 400):
        vChunk = vIds[i:i + 400]
        strPh = ",".join("?" * len(vChunk))
        cur.execute(f"DELETE FROM edges WHERE source IN ({strPh}) OR target IN ({strPh})",
                    vChunk + vChunk)
    if vIds:
        for i in range(0, len(vIds), 400):
            vChunk = vIds[i:i + 400]
            strPh = ",".join("?" * len(vChunk))
            cur.execute(f"DELETE FROM nodes_fts WHERE id IN ({strPh})", vChunk)
    cur.execute("DELETE FROM nodes WHERE file_path = ?", (rel_path,))
    cur.execute("DELETE FROM files WHERE path = ?", (rel_path,))


def _FnInsertFileNodes(cur: sqlite3.Connection, repo_path: str,
                       file_path: str, rel_path: str) -> None:
    """Unified single-pass parser: AST headings, WikiLinks, FTS, and concept nodes."""
    try:
        stat = os.stat(file_path)
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
            lines = content.splitlines(keepends=True)
    except Exception:
        return

    c_hash = compute_hash(content)
    cur.execute("INSERT INTO files VALUES (?, ?, ?, ?, ?)",
            (rel_path, c_hash, stat.st_size, stat.st_mtime, 0))

    file_node_id = f"file::{rel_path}"
    file_tokens = math.ceil(len(content) / 3.8)
    cur.execute("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (file_node_id, rel_path, "file", os.path.basename(rel_path),
             0, 1, len(lines), file_tokens, content))

    heading_stack: List[Tuple[int, str]] = [(0, file_node_id)]
    headings_in_file = 0
    in_code_block = False
    wikilink_pat = re.compile(r"\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]")
    b_is_catalog = (os.path.basename(rel_path).upper() == "DOC_CATALOG.MD")

    for idx, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue

        # 1. Heading AST Node
        m = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if m:
            level = len(m.group(1))
            title = re.sub(r"\s+#+$", "", m.group(2).strip())
            node_id = f"heading::{rel_path}::L{idx}::{title[:30]}"
            headings_in_file += 1
            sec_lines = [line]
            for nxt in range(idx, min(len(lines), idx + 20)):
                sec_lines.append(lines[nxt])
            sec_content = "".join(sec_lines)
            cur.execute("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (node_id, rel_path, f"heading_{level}", title, level,
                     idx, idx, math.ceil(len(sec_content) / 3.8), sec_content))
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            parent_id = heading_stack[-1][1] if heading_stack else file_node_id
            cur.execute("INSERT OR IGNORE INTO edges VALUES (?, ?, ?, ?, ?)",
                    (f"edge::{parent_id}->{node_id}", parent_id, node_id,
                     "parent_child", idx))
            heading_stack.append((level, node_id))

        # 2. WikiLink & Concept Inline Extraction (Option A)
        # AST Isolation Guard: Never extract concepts or wikilinks from system DOC_CATALOG.MD
        if not b_is_catalog:
            line_clean = re.sub(r"`[^`\n]+`", "", line)
            for wm in wikilink_pat.finditer(line_clean):
                conc = wm.group(1).strip()
                if conc and len(conc) <= 60:
                    # Check exclusion tombstone
                    cur.execute("SELECT 1 FROM concept_exclusions WHERE concept_name = ? AND file_path = ?", (conc, rel_path))
                    if cur.fetchone():
                        continue  # Skipped: permanently excluded by user!

                    cid = f"concept::{conc}"
                    cur.execute("INSERT OR IGNORE INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (cid, rel_path, "concept", conc, 0, idx, idx, 1, f"Concept tag: {conc}"))
                    
                    # Robust binding:
                    # If this line is a file-level tag container (Concepts: ..., <!-- docgraph:tags -->, or > 🏷️ 概念標籤:)
                    # it MUST bind directly to the File node (file_node_id), NEVER to an arbitrary preceding heading!
                    is_file_level = ("Concepts:" in line) or ("docgraph:tags" in line) or ("> 🏷️ 概念標籤:" in line)
                    src_id = file_node_id if (is_file_level or not heading_stack) else heading_stack[-1][1]
                    edge_id = f"wikilink::{src_id}::L{idx}->{cid}"
                    cur.execute("INSERT OR IGNORE INTO edges VALUES (?, ?, ?, ?, ?)",
                        (edge_id, src_id, cid, "wiki_link", idx))

    cur.execute("UPDATE files SET node_count = ? WHERE path = ?",
            (headings_in_file + 1, rel_path))
    try:
        cur.execute("INSERT INTO nodes_fts(id, name, content) "
                    "SELECT id, name, content FROM nodes WHERE file_path = ?",
                (rel_path,))
    except Exception:
        pass


def _FnRebuildDocLinks(cur: sqlite3.Connection, repo_path: str,
                       md_files: List[str]) -> None:
    """Rebuild every cross-document edge (doc_link) from CURRENT file contents.

    Runs as a separate pass so incremental indexing only re-parses changed
    files while link topology stays globally accurate.
    """
    cur.execute("DELETE FROM edges WHERE kind = 'doc_link'")

    all_rel_files = set(os.path.relpath(f, repo_path).replace("\\", "/") for f in md_files)
    all_rel_lower = {f.lower(): f for f in all_rel_files}
    basename_counts: Dict[str, int] = {}
    for f in all_rel_files:
        b = os.path.basename(f)
        basename_counts[b] = basename_counts.get(b, 0) + 1
    unique_basenames = {b: f for b, f in
                        [(os.path.basename(f), f) for f in all_rel_files]
                        if basename_counts[b] == 1}

    link_pattern = re.compile(r"\[([^\]]+)\]\(([^)#\s]+)(?:#[^)]*)?\)")
    pending: List[Tuple[str, str, str, str, int]] = []

    for file_path in md_files:
        rel_path = os.path.relpath(file_path, repo_path).replace("\\", "/")

        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception:
            continue

        current_dir = os.path.dirname(rel_path)
        linked_targets = set()

        for lm in link_pattern.finditer(content):
            raw_target = lm.group(2).strip().replace("\\", "/")
            raw_target = urllib.parse.unquote(raw_target)
            if re.match(r"^(?:https?|mailto|ftp):", raw_target):
                continue
            candidates = [
                os.path.normpath(os.path.join(current_dir, raw_target)).replace("\\", "/"),
                os.path.normpath(os.path.join(current_dir, raw_target + ".md")).replace("\\", "/"),
                os.path.normpath(os.path.join(current_dir, raw_target, "README.md")).replace("\\", "/"),
                os.path.normpath(raw_target).replace("\\", "/"),
                os.path.normpath(raw_target + ".md").replace("\\", "/")
            ]
            for cand in candidates:
                cand_l = cand.lower()
                if cand_l in all_rel_lower and all_rel_lower[cand_l] != rel_path:
                    target_match = all_rel_lower[cand_l]
                    if target_match not in linked_targets:
                        linked_targets.add(target_match)
                        pending.append((f"link::file::{rel_path}->file::{target_match}",
                                        f"file::{rel_path}", f"file::{target_match}",
                                        "doc_link", 0))
                    break

        for other_f in all_rel_files:
            if other_f != rel_path and other_f not in linked_targets and other_f in content:
                linked_targets.add(other_f)
                pending.append((f"path::file::{rel_path}->file::{other_f}",
                                f"file::{rel_path}", f"file::{other_f}", "doc_link", 0))

        for b, target_f in unique_basenames.items():
            if target_f != rel_path and target_f not in linked_targets and len(b) > 6:
                if b not in ["README.md", "requirements.txt", "SKILL.md"] and b in content:
                    linked_targets.add(target_f)
                    pending.append((f"mention::file::{rel_path}->file::{target_f}",
                                    f"file::{rel_path}", f"file::{target_f}", "doc_link", 0))

    for e in pending:
        cur.execute("INSERT OR IGNORE INTO edges VALUES (?, ?, ?, ?, ?)", e)


def index_repository(repo_path: str, incremental: bool = False) -> Dict[str, Any]:
    """Index a repository's markdown into SQLite.

    incremental=True  -> content_hash/size/mtime based: only changed files are
    re-parsed; removed files are pruned; cross-doc links are rebuilt globally.
    Returns {files, parsed, skipped, nodes, edges, incremental}.
    """
    repo_path = os.path.abspath(repo_path)
    db_path = get_db_path(repo_path)
    b_existed = os.path.exists(db_path)
    conn = init_db(db_path)
    cur = conn.cursor()

    md_files = _FnWalkDocFiles(repo_path)
    rel_to_file = {os.path.relpath(f, repo_path).replace("\\", "/"): f for f in md_files}

    existing: Dict[str, Tuple[int, float, str]] = {}
    if incremental and b_existed:
        try:
            cur.execute("SELECT path, size, modified_at, content_hash FROM files")
            existing = {r[0]: (r[1] or 0, r[2] or 0.0, r[3] or "") for r in cur.fetchall()}
        except Exception:
            existing = {}

    b_full = not (incremental and existing)

    if b_full:
        cur.execute("DELETE FROM edges;")
        cur.execute("DELETE FROM nodes;")
        cur.execute("DELETE FROM files;")
        try:
            cur.execute("DELETE FROM nodes_fts;")
        except Exception:
            pass
        to_parse = list(rel_to_file.items())
        vGone: List[str] = []
    else:
        vGone = [rel for rel in existing if rel not in rel_to_file]
        for rel in vGone:
            _FnDeleteFileRows(cur, rel)
        to_parse = []
        for rel, fpath in rel_to_file.items():
            try:
                st = os.stat(fpath)
            except Exception:
                continue
            old = existing.get(rel)
            if old and int(old[0]) == st.st_size and abs(float(old[1]) - st.st_mtime) < 1e-3:
                continue  # size+mtime unchanged -> skip read & parse entirely
            # changed on disk: confirm by content hash before re-parsing
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    c_hash = compute_hash(f.read())
            except Exception:
                continue
            if old and old[2] == c_hash:
                # touch mtime/size so next run hits the fast path
                cur.execute("UPDATE files SET size = ?, modified_at = ? WHERE path = ?",
                            (st.st_size, st.st_mtime, rel))
                continue
            to_parse.append((rel, fpath))

    for rel, fpath in to_parse:
        _FnDeleteFileRows(cur, rel)
        _FnInsertFileNodes(cur, repo_path, fpath, rel)

    _FnRebuildDocLinks(cur, repo_path, md_files)

    conn.commit()
    _FnSyncGlobalIndex(cur, repo_path)
    cur.execute("SELECT count(*) FROM nodes")
    n_nodes = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM edges")
    n_edges = cur.fetchone()[0]
    conn.close()
    return {"files": len(md_files), "parsed": len(to_parse),
            "skipped": len(md_files) - len(to_parse), "removed": len(vGone),
            "nodes": n_nodes, "edges": n_edges,
            "incremental": bool(not b_full)}


def record_log(repo_path: str, action: str, target_file: str = "", source_material: str = "", summary: str = "") -> None:
    """Record operation log cleanly into SQLite database (no disk log.md garbage).

    Idempotent: automatically ensures `operation_logs` table exists even in legacy databases.
    """
    repo_path = os.path.abspath(repo_path)
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db_path = get_db_path(repo_path)
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS operation_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    action TEXT NOT NULL,
                    target_file TEXT,
                    source_material TEXT,
                    summary TEXT
                );
            """)
            cur.execute(
                "INSERT INTO operation_logs(timestamp, action, target_file, source_material, summary) VALUES (?, ?, ?, ?, ?)",
                (now_str, action, target_file, source_material, summary)
            )
            conn.commit()
            conn.close()
        except Exception:
            pass


def _FnSyncGlobalIndex(cur: sqlite3.Cursor, repo_path: str) -> None:
    """Compile global DOC_CATALOG.md with hash guard."""
    try:
        cur.execute("SELECT path FROM files ORDER BY path")
        file_rows = cur.fetchall()
        # Count distinct document sources referencing each concept via wiki_link edges
        cur.execute("""
            SELECT n.name, COUNT(DISTINCT e.source) AS ref_count
            FROM nodes n
            JOIN edges e ON e.target = n.id AND e.kind = 'wiki_link'
            WHERE n.kind = 'concept'
            GROUP BY n.id, n.name
            HAVING ref_count >= 2
            ORDER BY ref_count DESC
        """)
        concept_rows = cur.fetchall()
        now_date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        md = [
            "<!-- DOCGRAPH_SYSTEM_GENERATED_INDEX: DO NOT EDIT DIRECTLY -->",
            "# DocGraph Knowledge Base Catalog",
            "",
            f"> Synced at `{now_date}` | {len(file_rows)} docs, {len(concept_rows)} core concepts",
            "",
            "---",
            "",
            "## Key Concepts & Tags",
        ]
        if concept_rows:
            for cname, ccnt in concept_rows:
                md.append(f"- [[{cname}]] (references: {ccnt})")
        else:
            md.append("*(None exceeding threshold)*")
        md.extend(["", "---", "", "## Document Directory", ""])
        dir_groups = {}
        for (fpath,) in file_rows:
            dname = os.path.dirname(fpath) or "."
            dir_groups.setdefault(dname, []).append(fpath)
        for dname in sorted(dir_groups.keys()):
            md.append(f"### {dname}" if dname != "." else "### Root")
            for fpath in sorted(dir_groups[dname]):
                bname = os.path.basename(fpath)
                md.append(f"- [{bname}]({urllib.parse.quote(fpath)})")
                cur.execute("SELECT name, level FROM nodes WHERE file_path = ? AND level IN (1, 2, 3, 4) ORDER BY start_line", (fpath,))
                for hname, hlvl in cur.fetchall():
                    indent_spaces = "  " * int(hlvl)
                    q_file = urllib.parse.quote(fpath)
                    q_anchor = urllib.parse.quote(hname)
                    md.append(f"{indent_spaces}- [{hname}]({q_file}#{q_anchor})")
            md.append("")
        final_content = "\n".join(md) + "\n"
        idx_path = os.path.join(repo_path, "DOC_CATALOG.md")
        if os.path.exists(idx_path):
            try:
                with open(idx_path, "r", encoding="utf-8", errors="replace") as f:
                    cur_old = f.read()
                old_core = "\n".join(cur_old.splitlines()[4:])
                new_core = "\n".join(final_content.splitlines()[4:])
                if old_core == new_core:
                    return
            except Exception:
                pass
        with open(idx_path, "w", encoding="utf-8") as f:
            f.write(final_content)
    except Exception:
        pass


def fetch_graph_data(repo_path: str) -> Dict[str, Any]:
    repo_path = os.path.abspath(repo_path)
    db_path = get_db_path(repo_path)
    if not os.path.exists(db_path):
        index_repository(repo_path)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Fetch nodes, filtering out isolated concepts (must have >= 2 distinct sources)
    cur.execute("""
        SELECT id, name, kind, level, start_line, end_line, token_estimate, file_path, content
        FROM nodes
        WHERE kind != 'concept'
           OR id IN (SELECT target FROM edges WHERE kind = 'wiki_link')
           OR name IN (SELECT name FROM concepts);
    """)
    rows = cur.fetchall()

    nodes = []
    KIND_COLORS = {
        "concept": "#e2e8f0",
        "file": "#f0883e",       # Document (Warm Cyber Orange)
        "heading_1": "#58a6ff",  # H1 Primary (Electric Blue)
        "heading_2": "#3fb950",  # H2 Major (Emerald Green)
        "heading_3": "#bc8cff",  # H3 Subsection (Vivid Purple)
        "heading_4": "#ff7bba",  # H4 Detail (Vibrant Rose Pink - 100% distinct from Document Orange!)
        "heading_5": "#00d2d3",  # H5 Fine (Cyan / Turquoise)
        "heading_6": "#ffd700",  # H6 Micro (Bright Gold)
    }

    # Hierarchy-based gradual sizing: File(12) -> H1(8.5) -> H2(6.0) -> H3(4.2) -> H4(3.0) -> H5/6(2.2)
    KIND_VALS = {
        "concept": 9.5,
        "file": 12.0,
        "heading_1": 8.5,
        "heading_2": 6.0,
        "heading_3": 4.2,
        "heading_4": 3.0,
        "heading_5": 2.2,
        "heading_6": 1.8
    }

    for r in rows:
        nid, name, kind, level, start_l, end_l, tokens, fpath, content = r
        val = KIND_VALS.get(kind, 3.0)
        nodes.append({
            "id": nid,
            "name": name,
            "kind": kind,
            "level": level,
            "line": start_l,
            "file": fpath,
            "abs_path": os.path.normpath(os.path.join(repo_path, fpath)) if not os.path.isabs(fpath) else fpath,
            "tokens": tokens,
            "val": val,
            "color": KIND_COLORS.get(kind, "#8b949e"),
            "content": content
        })

    cur.execute("SELECT id, source, target, kind FROM edges;")
    edges = []
    for r in cur.fetchall():
        eid, src, tgt, kind = r
        edges.append({
            "id": eid,
            "source": src,
            "target": tgt,
            "kind": kind,
            "color": "rgba(88, 166, 255, 0.45)" if kind == "parent_child" else "rgba(0, 255, 170, 0.75)"
        })

    conn.close()
    return {"nodes": nodes, "links": edges}


def fetch_graph_merged(repo_paths: List[str]) -> Dict[str, Any]:
    """Merge several repositories' graphs into ONE payload (galaxy-style).

    - Deeper (more specific) repository wins on duplicate files: each document
      is kept exactly once even when a parent root's DB also indexes it.
    - Node ids are namespaced per source DB so identical rel paths from
      different repos (two README.md) never collide.
    - Every node gets `project` = basename of the longest requested path that
      contains it, so the frontend groups the tree by REAL repo ownership
      (unindexed children included in repo_paths still own their files).
    Single path -> identical to fetch_graph_data() (legacy behavior).
    """
    vPaths: List[str] = []
    for p in repo_paths:
        a = os.path.abspath(p) if p else ""
        if a and os.path.isdir(a) and a not in vPaths:
            vPaths.append(a)
    if not vPaths:
        return {"nodes": [], "links": []}
    if len(vPaths) == 1:
        return fetch_graph_data(vPaths[0])

    # Owner candidates: longest prefix first.
    vOwners = sorted(vPaths, key=len, reverse=True)

    def owner_of(abs_path: str) -> str:
        clean = os.path.normpath(abs_path)
        for op in vOwners:
            if clean == op or clean.startswith(op + os.sep):
                return os.path.basename(op) or op
        return os.path.basename(clean) or clean

    # Sources WITH an existing DB; deeper repos first so they win dedup.
    vSources: List[Tuple[int, str]] = []
    for i, p in enumerate(vPaths):
        if _FnExistingDbPath(p):
            vSources.append((i, p))
    vSources.sort(key=lambda t: (-t[1].count(os.sep), -len(t[1])))

    kept: Dict[Tuple[str, str, int, str], Dict[str, Any]] = {}
    vIdMaps: Dict[int, Dict[str, str]] = {}
    edges_out: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    for iSrc, pSrc in vSources:
        data = fetch_graph_data(pSrc)
        id_map: Dict[str, str] = {}
        for n in data.get("nodes", []):
            strOrig = n.get("id") or ""
            key = ((n.get("abs_path") or "").lower(), n.get("kind") or "",
                   int(n.get("line") or 0), (n.get("name") or "").lower())
            if key in kept:
                # duplicate of a deeper repo's file -> remap our id to the keeper
                id_map[strOrig] = kept[key]["id"]
                continue
            n["id"] = f"p{iSrc}::{strOrig}"
            n["project"] = owner_of(n.get("abs_path") or "")
            kept[key] = n
            id_map[strOrig] = n["id"]
        vIdMaps[iSrc] = id_map
        for l in data.get("links", []):
            strNewSrc = id_map.get(l.get("source") or "")
            strNewTgt = id_map.get(l.get("target") or "")
            if not strNewSrc or not strNewTgt:
                continue  # endpoint belonged to a dropped duplicate
            strKind = l.get("kind") or ""
            kEdge = (strNewSrc, strNewTgt, strKind)
            if kEdge in edges_out:
                continue
            edges_out[kEdge] = {
                "id": f"{strKind}::{strNewSrc}->{strNewTgt}",
                "source": strNewSrc, "target": strNewTgt, "kind": strKind,
                "color": l.get("color"),
            }

    return {"nodes": list(kept.values()), "links": list(edges_out.values())}


def fts_search(repo_paths: List[str], query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """FTS5 search across several repos' SQLite indexes.

    Returns [{id, name, file, kind, level, line, path}] ordered by rank.
    `path` is the owning repo root so the frontend can resolve the node in
    the merged graph by (file, line, kind).
    """
    strQ = (query or "").strip()
    if not strQ:
        return []
    vTokens = [t.replace('"', "") for t in re.split(r"\s+", strQ) if t][:8]
    if not vTokens:
        return []
    strMatch = " OR ".join(f'"{t}"*' for t in vTokens)

    out: List[Dict[str, Any]] = []
    seen: set = set()
    for p in repo_paths:
        a = os.path.abspath(p) if p else ""
        db = _FnExistingDbPath(a) if a and os.path.isdir(a) else None
        if not db:
            continue
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            cur = conn.cursor()
            cur.execute(
                "SELECT nodes.id, nodes.name, nodes.file_path, nodes.kind, "
                "       nodes.level, nodes.start_line "
                "  FROM nodes_fts JOIN nodes ON nodes.id = nodes_fts.id "
                " WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ?",
                (strMatch, limit))
            for r in cur.fetchall():
                strKey = (r[0],)
                if strKey in seen:
                    continue
                seen.add(strKey)
                out.append({"id": r[0], "name": r[1], "file": r[2],
                            "kind": r[3], "level": r[4], "line": r[5],
                            "path": a})
                if len(out) >= limit:
                    break
            conn.close()
        except Exception:
            continue
        if len(out) >= limit:
            break
    return out


def get_indexed_file_set(repo_path: str) -> Optional[set]:
    """Relative paths currently in the index (None = repo has no DB)."""
    db = _FnExistingDbPath(repo_path)
    if not db:
        return None
    try:
        conn = sqlite3.connect(db)
        cur = conn.cursor()
        cur.execute("SELECT path FROM files")
        s = {r[0] for r in cur.fetchall()}
        conn.close()
        return s
    except Exception:
        return None



def get_db_stats(repo_path: str) -> Dict[str, Any]:
    """Get node and link counts for a repository database."""
    repo_path = os.path.abspath(repo_path)
    for candidate in [
        os.path.join(repo_path, ".docgraphical", "docgraphical.db"),
        os.path.join(repo_path, ".docgraph", "docgraph.db"),
        os.path.join(repo_path, ".docgraphical", "docgraph.db"),
        os.path.join(repo_path, ".docgraph", "docgraphical.db"),
    ]:
        if os.path.exists(candidate):
            try:
                conn = sqlite3.connect(candidate)
                cur = conn.cursor()
                cur.execute("SELECT count(*) FROM nodes")
                n_cnt = cur.fetchone()[0]
                cur.execute("SELECT count(*) FROM edges")
                e_cnt = cur.fetchone()[0]
                conn.close()
                return {"has_db": True, "nodes": n_cnt, "links": e_cnt}
            except Exception:
                pass
    return {"has_db": False, "nodes": 0, "links": 0}


def uninit_repository(repo_path: str) -> bool:
    """Delete .docgraphical and .docgraph directories for a repository."""
    import shutil
    repo_path = os.path.abspath(repo_path)
    removed = False
    for dot_name in [".docgraphical", ".docgraph"]:
        dot_dir = os.path.join(repo_path, dot_name)
        if os.path.exists(dot_dir):
            try:
                shutil.rmtree(dot_dir)
                removed = True
            except Exception as e:
                print(f"Error removing {dot_dir}: {e}")
    return removed


# ─── Concepts Registry & Exclusion Architecture ────────────────────

def get_concepts_tree(repo_path: str) -> dict:
    """Fetch all concepts grouped by category with live reference counts & candidate counts."""
    db_p = get_db_path(repo_path)
    if not db_p or not os.path.exists(db_p):
        return {"ok": False, "error": "Database not initialized"}
    
    conn = sqlite3.connect(db_p)
    cur = conn.cursor()
    try:
        # 1. Ensure table exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS concepts (
                name TEXT PRIMARY KEY,
                category TEXT DEFAULT '未分類',
                aliases TEXT DEFAULT '',
                status TEXT DEFAULT 'official',
                created_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS concept_exclusions (
                concept_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (concept_name, file_path)
            )
        """)

        # 2. Count live references in edges
        cur.execute("""
            SELECT target, COUNT(DISTINCT source) 
            FROM edges 
            WHERE kind = 'wiki_link' 
            GROUP BY target
        """)
        ref_counts = {}
        for tgt, cnt in cur.fetchall():
            cname = tgt.replace("concept::", "")
            ref_counts[cname] = cnt

        # 3. Fetch concepts
        cur.execute("SELECT name, category, aliases, status, created_at FROM concepts")
        rows = cur.fetchall()

        official_tree = {} # { category: [ { name, aliases, refs, createdAt } ] }
        candidates = []

        for name, category, aliases, status, created_at in rows:
            raw_c = (category or "").strip()
            cat = "Uncategorized" if (not raw_c or raw_c in ("未分類", "Uncategorized")) else raw_c
            refs = ref_counts.get(name, 0)
            item = {
                "name": name,
                "category": cat,
                "aliases": aliases or "",
                "refs": refs,
                "status": status,
                "createdAt": created_at
            }
            if status == "candidate":
                candidates.append(item)
            else:
                if cat not in official_tree:
                    official_tree[cat] = []
                official_tree[cat].append(item)

        # 4. Auto-discover candidate concepts from edges that are not yet in concepts table
        cur.execute("""
            SELECT target, COUNT(DISTINCT source) 
            FROM edges 
            WHERE kind = 'wiki_link' 
            GROUP BY target 
            HAVING COUNT(DISTINCT source) >= 2
        """)
        known_names = {r[0] for r in rows}
        for tgt, cnt in cur.fetchall():
            cname = tgt.replace("concept::", "")
            if cname not in known_names:
                # Add auto candidate
                cand_item = {
                    "name": cname,
                    "category": "待審候選",
                    "aliases": "AI 自動偵測",
                    "refs": cnt,
                    "status": "candidate",
                    "createdAt": time.strftime("%Y-%m-%d %H:%M:%S")
                }
                candidates.append(cand_item)

        return {
            "ok": True,
            "tree": official_tree,
            "candidates": candidates,
            "counts": {
                "official": sum(len(v) for v in official_tree.values()),
                "candidates": len(candidates)
            }
        }
    finally:
        conn.close()


def resolve_all_doc_repos(repo_path=None) -> List[str]:
    """Resolve all repositories: explicit input + all scanned repositories."""
    repos = []
    if isinstance(repo_path, list):
        repos = [os.path.abspath(r) for r in repo_path if r and str(r).strip()]
    elif isinstance(repo_path, str) and repo_path.strip():
        for p in repo_path.split(","):
            p = p.strip()
            if p: repos.append(os.path.abspath(p))

    try:
        from .config import get_search_roots
        from .scanner import scan_doc_repositories
        scanned = scan_doc_repositories(get_search_roots())
        items = scanned.values() if isinstance(scanned, dict) else scanned
        for v in items:
            p = v.get("path", "") if isinstance(v, dict) else str(v)
            if p: repos.append(os.path.abspath(p))
    except Exception:
        pass

    seen = set()
    uniq = []
    for r in repos:
        if r and r not in seen and os.path.exists(r):
            seen.add(r)
            uniq.append(r)
    return uniq


def get_concept_linked_files(repo_path, concept_name: str) -> dict:
    """Fetch all files across repositories that reference this concept with line number and snippet."""
    repos = resolve_all_doc_repos(repo_path)
    if not repos:
        return {"ok": False, "error": "No valid repositories found"}

    all_res_list = []
    seen_entries = set()
    cid = f"concept::{concept_name}"

    for rp in repos:
        db_p = get_db_path(rp)
        if not db_p or not os.path.exists(db_p):
            continue
        try:
            conn = sqlite3.connect(db_p)
            cur = conn.cursor()
            cur.execute("""
                SELECT e.source, e.line 
                FROM edges e 
                WHERE (e.target = ? OR e.target = ?) AND e.kind = 'wiki_link'
                ORDER BY e.source, e.line
            """, (cid, concept_name))
            rows = cur.fetchall()

            files_map = {}
            for src, line in rows:
                if src not in files_map:
                    files_map[src] = []
                files_map[src].append(line)

            for src, lines in files_map.items():
                clean_rel_file = src.replace("file::", "") if src.startswith("file::") else src
                if clean_rel_file.startswith("heading::"):
                    parts = clean_rel_file.split("::")
                    clean_rel_file = parts[1] if len(parts) > 1 else clean_rel_file

                abs_p = os.path.join(rp, clean_rel_file)
                snippet = ""
                if os.path.exists(abs_p):
                    try:
                        with open(abs_p, "r", encoding="utf-8", errors="ignore") as f:
                            all_lines = f.readlines()
                        first_line_idx = (lines[0] - 1) if lines else 0
                        if 0 <= first_line_idx < len(all_lines):
                            snippet = all_lines[first_line_idx].strip()[:100]
                    except Exception:
                        pass

                entry_key = (rp, src, lines[0] if lines else 0)
                if entry_key not in seen_entries:
                    seen_entries.add(entry_key)
                    all_res_list.append({
                        "filePath": src.replace("file::", "") if src.startswith("file::") else src,
                        "cleanPath": clean_rel_file,
                        "lines": lines,
                        "snippet": snippet,
                        "repoPath": rp
                    })
            conn.close()
        except Exception:
            pass

    return {"ok": True, "concept": concept_name, "files": all_res_list}


def save_concept(repo_path: str, name: str, category: str = "未分類", aliases: str = "", status: str = "official") -> dict:
    """Create or update official concept."""
    db_p = get_db_path(repo_path)
    if not db_p or not os.path.exists(db_p):
        return {"ok": False, "error": "Database not initialized"}
    
    conn = sqlite3.connect(db_p)
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS concepts (
                name TEXT PRIMARY KEY,
                category TEXT DEFAULT '未分類',
                aliases TEXT DEFAULT '',
                status TEXT DEFAULT 'official',
                created_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS concept_exclusions (
                concept_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (concept_name, file_path)
            )
        """)
        cur.execute("""
            INSERT INTO concepts (name, category, aliases, status, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                category = excluded.category,
                aliases = excluded.aliases,
                status = excluded.status
        """, (name.strip(), (category or "未分類").strip(), aliases.strip(), status, time.strftime("%Y-%m-%d %H:%M:%S")))
        conn.commit()

        # Ensure physical tag markdown file exists in <repo>/.docgraphical/tags/<name>.md
        try:
            tags_dir = os.path.join(repo_path, ".docgraphical", "tags")
            os.makedirs(tags_dir, exist_ok=True)
            tag_md_path = os.path.join(tags_dir, f"{name}.md")
            if not os.path.exists(tag_md_path):
                with open(tag_md_path, "w", encoding="utf-8") as tf:
                    tf.write(f"# 🏷️ [[{name}]]\n\n> 分類: {category} | 別名: {aliases or '無'}\n\n## 概念簡述\n(此處可撰寫此概念標籤的詳細說明、起源或規範備註)\n")
        except Exception as e:
            pass

        return {"ok": True, "name": name}
    finally:
        conn.close()


def merge_concepts(repo_path: str, source_name: str, target_name: str, add_as_alias: bool = True) -> dict:
    """Atomically merge source concept into target concept."""
    db_p = get_db_path(repo_path)
    if not db_p or not os.path.exists(db_p):
        return {"ok": False, "error": "Database not initialized"}
    
    conn = sqlite3.connect(db_p)
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS concepts (
                name TEXT PRIMARY KEY,
                category TEXT DEFAULT '未分類',
                aliases TEXT DEFAULT '',
                status TEXT DEFAULT 'official',
                created_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS concept_exclusions (
                concept_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (concept_name, file_path)
            )
        """)
        src_cid = f"concept::{source_name}"
        tgt_cid = f"concept::{target_name}"

        # 1. Re-target edges
        cur.execute("UPDATE edges SET target = ? WHERE target = ? AND kind = 'wiki_link'", (tgt_cid, src_cid))

        # 2. Update aliases of target
        if add_as_alias:
            cur.execute("SELECT aliases FROM concepts WHERE name = ?", (target_name,))
            row = cur.fetchone()
            cur_aliases = row[0] if row and row[0] else ""
            cur.execute("SELECT aliases FROM concepts WHERE name = ?", (source_name,))
            src_row = cur.fetchone()
            src_aliases = src_row[0] if src_row and src_row[0] else ""

            combined = set([a.strip() for a in cur_aliases.split(",") if a.strip()])
            combined.add(source_name)
            for a in src_aliases.split(","):
                if a.strip():
                    combined.add(a.strip())

            new_aliases_str = ", ".join(sorted(list(combined)))
            cur.execute("UPDATE concepts SET aliases = ? WHERE name = ?", (new_aliases_str, target_name))

        # 3. Delete old nodes and concept entry
        cur.execute("DELETE FROM nodes WHERE id = ?", (src_cid,))
        cur.execute("DELETE FROM concepts WHERE name = ?", (source_name,))

        conn.commit()
        return {"ok": True, "source": source_name, "target": target_name}
    finally:
        conn.close()


def unlink_concept_file(repo_path: str, concept_name: str, rel_file_path: str, rewrite_disk: bool = True) -> dict:
    """Unlink a concept from a file or specific heading with surgical precision:
    1. Parse real relative file path and target heading/line from 'heading::FILE::L...::...' or 'file::FILE'
    2. Surgically wipe the exact tag line or inline [[concept]] from disk, leaving other sections 100% untouched
    3. Re-index repo so live reference count & 3D links update immediately without collateral damage
    """
    repo_path = os.path.abspath(repo_path)
    db_p = get_db_path(repo_path)
    if not db_p or not os.path.exists(db_p):
        return {"ok": False, "error": "Database not initialized"}

    # Extract target scope
    is_heading = rel_file_path.startswith("heading::")
    clean_file = rel_file_path
    target_line = None
    target_heading = None

    if is_heading:
        parts = rel_file_path.split("::")
        if len(parts) >= 2:
            clean_file = parts[1]
        if len(parts) >= 3 and parts[2].startswith("L"):
            try:
                target_line = int(parts[2][1:])
            except Exception:
                pass
        if len(parts) >= 4:
            target_heading = parts[3].strip()
    elif clean_file.startswith("file::"):
        clean_file = clean_file[6:]

    clean_file = clean_file.replace("\\", "/")

    # Cross-repo file lookup: if file not in repo_path, find owning repo
    abs_p = os.path.join(repo_path, clean_file)
    if not os.path.exists(abs_p):
        for r in resolve_all_doc_repos(repo_path):
            cand = os.path.join(r, clean_file)
            if os.path.exists(cand):
                repo_path = r
                abs_p = cand
                db_p = get_db_path(r)
                break

    # 1. Surgical physical rewrite on disk
    if rewrite_disk:
        if os.path.exists(abs_p):
            with open(abs_p, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()

            tag_pat = re.compile(r'\[\[\s*' + re.escape(concept_name) + r'(\s*\|\s*([^\]]+))?\s*\]\]')
            
            def is_pure_tag_line(line_str):
                s = tag_pat.sub('', line_str)
                s = re.sub(r'[>\s🏷️#:\-–—\*\`]|概念標籤|標籤|Concepts?', '', s)
                return len(s) == 0

            new_lines = []
            removed = False

            if is_heading:
                h_idx = -1
                if target_line is not None and 1 <= target_line <= len(lines):
                    h_idx = target_line - 1
                elif target_heading:
                    h_clean = target_heading.strip().lower()
                    for idx, l in enumerate(lines):
                        if l.strip().startswith('#') and h_clean in l.lower():
                            h_idx = idx
                            break
                
                for idx, l in enumerate(lines):
                    if not removed and h_idx >= 0 and h_idx <= idx <= min(len(lines)-1, h_idx + 8):
                        if idx > h_idx and l.strip().startswith('#'):
                            new_lines.append(l)
                            continue
                        if tag_pat.search(l):
                            if is_pure_tag_line(l):
                                removed = True
                                continue
                            else:
                                new_lines.append(tag_pat.sub(lambda m: m.group(2) if m.group(2) else concept_name, l, count=1))
                                removed = True
                                continue
                    new_lines.append(l)
            else:
                # File-level removal: scan first 40 lines
                for idx, l in enumerate(lines):
                    if not removed and idx <= 40 and tag_pat.search(l):
                        if ('概念標籤' in l or '標籤' in l or 'Concepts' in l) or is_pure_tag_line(l):
                            if is_pure_tag_line(l):
                                removed = True
                                continue
                            else:
                                new_lines.append(tag_pat.sub(lambda m: m.group(2) if m.group(2) else concept_name, l, count=1))
                                removed = True
                                continue
                    new_lines.append(l)

                if not removed:
                    final_lines = []
                    for l in new_lines:
                        if not removed and tag_pat.search(l):
                            if is_pure_tag_line(l):
                                removed = True
                                continue
                            else:
                                final_lines.append(tag_pat.sub(lambda m: m.group(2) if m.group(2) else concept_name, l, count=1))
                                removed = True
                                continue
                        final_lines.append(l)
                    new_lines = final_lines

            # Write back cleanly
            with open(abs_p, "w", encoding="utf-8") as f:
                f.writelines(new_lines)

    # 2. Database cleanup: Clear legacy whole-file exclusions so remaining references are never blocked
    conn = sqlite3.connect(db_p)
    cur = conn.cursor()
    try:
        cid = f"concept::{concept_name}"
        if is_heading:
            t_line = target_line if target_line is not None else -1
            cur.execute("""
                DELETE FROM edges 
                WHERE (source = ? OR source LIKE ?) AND target = ? AND kind = 'wiki_link'
            """, (rel_file_path, f"heading::{clean_file}::L{t_line}::%", cid))
        else:
            cur.execute("""
                DELETE FROM edges 
                WHERE (source = ? OR source = ?) AND target = ? AND kind = 'wiki_link'
            """, (f"file::{clean_file}", clean_file, cid))

        cur.execute("DELETE FROM concept_exclusions WHERE concept_name = ? AND file_path = ?", (concept_name, clean_file))
        conn.commit()

        # 3. Force re-parsing this file to sync node/edge topology reliably
        abs_p = os.path.join(repo_path, clean_file)
        if os.path.exists(abs_p):
            _FnDeleteFileRows(cur, clean_file)
            _FnInsertFileNodes(cur, repo_path, abs_p, clean_file)
            md_files = _FnWalkDocFiles(repo_path)
            _FnRebuildDocLinks(cur, repo_path, md_files)
            conn.commit()
            _FnSyncGlobalIndex(cur, repo_path)
    finally:
        conn.close()

    return {"ok": True, "concept": concept_name, "file": clean_file}


def list_repo_markdown_files(repo_path: str) -> list:
    """List relative paths of all markdown documents in the repo."""
    repo_path = os.path.abspath(repo_path)
    md_files = _FnWalkDocFiles(repo_path)
    return sorted([os.path.relpath(f, repo_path).replace("\\", "/") for f in md_files])


def attach_concept_to_file(repo_path: str, concept_name: str, rel_file_path: str, heading: str = "") -> dict:
    """Attach a concept tag to a file or specific H-level heading:
    1. If heading provided: inject [[ConceptName]] right after that heading line!
    2. Else: append to file top (document-level tag).
    3. Force re-parse this file immediately (bypassing incremental mtime cache) so 3D links update instantly!
    """
    repo_path = os.path.abspath(repo_path)
    db_p = get_db_path(repo_path)
    if not db_p or not os.path.exists(db_p):
        return {"ok": False, "error": "Database not initialized"}

    abs_p = os.path.join(repo_path, rel_file_path)
    if not os.path.exists(abs_p):
        for r in resolve_all_doc_repos(repo_path):
            cand = os.path.join(r, rel_file_path)
            if os.path.exists(cand):
                repo_path = r
                abs_p = cand
                db_p = get_db_path(r)
                break
    if not os.path.exists(abs_p):
        return {"ok": False, "error": f"File not found: {rel_file_path}"}

    with open(abs_p, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()

    tag_str = f"[[{concept_name}]]"
    injected = False

    # Granular H-level injection
    if heading and heading.strip() and heading.strip() != "Full Document":
        h_clean = heading.strip().lower()
        for i, l in enumerate(lines):
            m = re.match(r"^(#{1,6})\s+(.+)$", l.strip())
            if m:
                htext = re.sub(r"\s+#+$", "", m.group(2).strip()).lower()
                if htext == h_clean or h_clean in htext:
                    lines.insert(i + 1, "\n> 🏷️ 標籤: " + tag_str + "\n\n")
                    injected = True
                    break

    if not injected:
        # File-level tag: Inject at the top of the file
        content = "".join(lines)
        if tag_str not in content:
            insert_idx = 0
            for i, l in enumerate(lines):
                if l.strip().startswith("# "):
                    insert_idx = i + 1
                    break
            lines.insert(insert_idx, "\n> 🏷️ 概念標籤: " + tag_str + "\n\n")

    with open(abs_p, "w", encoding="utf-8") as f:
        f.writelines(lines)

    # Database: Clear exclusions and FORCE re-parse this file immediately!
    conn = sqlite3.connect(db_p)
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM concept_exclusions WHERE concept_name = ? AND file_path = ?", (concept_name, rel_file_path))
        _FnDeleteFileRows(cur, rel_file_path)
        _FnInsertFileNodes(cur, repo_path, abs_p, rel_file_path)
        md_files = _FnWalkDocFiles(repo_path)
        _FnRebuildDocLinks(cur, repo_path, md_files)
        conn.commit()
        _FnSyncGlobalIndex(cur, repo_path)
    finally:
        conn.close()

    return {"ok": True, "concept": concept_name, "file": rel_file_path}


def get_concept_tag_page(repo_path, concept_name: str) -> dict:
    """Read the markdown file for this concept from .docgraphical/tags/<ConceptName>.md across repositories."""
    # 1. Fetch linked references across all repositories
    linked_res = get_concept_linked_files(repo_path, concept_name)
    files = linked_res.get("files", [])
    repos = resolve_all_doc_repos(repo_path)

    owning_repo = None
    tag_md_path = None

    # Priority A: Check if any repo that actually references this concept already has a tag md file
    for f in files:
        rp = f.get("repoPath")
        if rp:
            cand = os.path.join(rp, ".docgraphical", "tags", f"{concept_name}.md")
            if os.path.exists(cand):
                owning_repo = rp
                tag_md_path = cand
                break

    # Priority B: Check all other repos for an existing tag md file
    if not owning_repo:
        for r in repos:
            cand = os.path.join(r, ".docgraphical", "tags", f"{concept_name}.md")
            if os.path.exists(cand):
                owning_repo = r
                tag_md_path = cand
                break

    # Priority C: Repo that has the first reference
    if not owning_repo:
        if files and files[0].get("repoPath"):
            owning_repo = files[0]["repoPath"]
        elif repos:
            owning_repo = repos[0]
        else:
            owning_repo = os.path.abspath(".")
        
        tags_dir = os.path.join(owning_repo, ".docgraphical", "tags")
        os.makedirs(tags_dir, exist_ok=True)
        tag_md_path = os.path.join(tags_dir, f"{concept_name}.md")

    if not os.path.exists(tag_md_path):
        default_content = f"# 🏷️ {concept_name}\n\n## 概念簡述\n(此處可撰寫此概念標籤的詳細說明、起源或規範備註)\n"
        try:
            with open(tag_md_path, "w", encoding="utf-8") as f:
                f.write(default_content)
            content = default_content
        except Exception:
            content = default_content
    else:
        with open(tag_md_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

    clean_content = re.sub(r'# 🏷️ \[\[([^\]]+)\]\]', r'# 🏷️ \1', content)
    if clean_content != content:
        try:
            with open(tag_md_path, "w", encoding="utf-8") as f:
                f.write(clean_content)
        except Exception:
            pass
        content = clean_content

    return {
        "ok": True,
        "concept": concept_name,
        "path": os.path.relpath(tag_md_path, owning_repo).replace("\\", "/"),
        "content": content,
        "files": files,
        "repo": owning_repo
    }


def save_concept_tag_page(repo_path: str, concept_name: str, content: str) -> dict:
    """Save user edits to the concept tag markdown file."""
    repo_path = os.path.abspath(repo_path)
    tags_dir = os.path.join(repo_path, ".docgraphical", "tags")
    os.makedirs(tags_dir, exist_ok=True)
    tag_md_path = os.path.join(tags_dir, f"{concept_name}.md")

    with open(tag_md_path, "w", encoding="utf-8") as f:
        f.write(content)

    return {"ok": True, "concept": concept_name}


def delete_concept(repo_path: str, concept_name: str, clean_md_references: bool = True) -> dict:
    """Permanently delete a concept:
    1. Clean [[concept]] / [[concept|alias]] tags from all referencing Markdown files on disk.
    2. Remove tag markdown file in .docgraphical/tags/<name>.md if present.
    3. Remove from SQLite (concepts, nodes, edges, concept_exclusions).
    4. Re-sync doc links and global index.
    """
    repo_path = os.path.abspath(repo_path)
    repos = resolve_all_doc_repos(repo_path)
    if not repos:
        return {"ok": False, "error": "No valid repositories found"}

    cleaned_files = set()
    cid = f"concept::{concept_name}"

    for rp in repos:
        db_p = get_db_path(rp)
        if not db_p or not os.path.exists(db_p):
            continue

        conn = sqlite3.connect(db_p)
        cur = conn.cursor()
        try:
            # 1. Find all files linked to this concept
            cur.execute("""
                SELECT DISTINCT source FROM edges 
                WHERE (target = ? OR target = ?) AND kind = 'wiki_link'
            """, (cid, concept_name))
            sources = [r[0] for r in cur.fetchall()]

            # 2. Surgically clean Markdown files on disk
            if clean_md_references:
                tag_pat = re.compile(r'\[\[\s*' + re.escape(concept_name) + r'(\s*\|\s*([^\]]+))?\s*\]\]')

                for src in sources:
                    clean_file = src
                    if src.startswith("heading::"):
                        parts = src.split("::")
                        clean_file = parts[1] if len(parts) >= 2 else src
                    elif src.startswith("file::"):
                        clean_file = src[6:]
                    clean_file = clean_file.replace("\\", "/")

                    abs_p = os.path.join(rp, clean_file)
                    if not os.path.exists(abs_p):
                        for other_r in repos:
                            cand = os.path.join(other_r, clean_file)
                            if os.path.exists(cand):
                                abs_p = cand
                                break

                    if os.path.exists(abs_p) and abs_p not in cleaned_files:
                        try:
                            with open(abs_p, "r", encoding="utf-8", errors="replace") as f:
                                lines = f.readlines()

                            new_lines = []
                            file_modified = False
                            for line in lines:
                                if tag_pat.search(line):
                                    file_modified = True
                                    # Check if line is purely tags
                                    s_without = tag_pat.sub('', line)
                                    s_clean = re.sub(r'[\s>🏷️#:\-–—\*\`]|概念標籤|標籤|Concepts?', '', s_without)
                                    if len(s_clean.strip()) == 0:
                                        # Whole line was just this tag badge, omit it
                                        continue
                                    else:
                                        # Inline reference: replace [[name|alias]] with alias or keep clean
                                        new_l = tag_pat.sub(lambda m: m.group(2) if m.group(2) else '', line)
                                        # Clean up double commas if in tag list
                                        new_l = re.sub(r',\s*,', ', ', new_l)
                                        new_l = re.sub(r':\s*,', ': ', new_l)
                                        new_lines.append(new_l)
                                else:
                                    new_lines.append(line)

                            if file_modified:
                                with open(abs_p, "w", encoding="utf-8") as f:
                                    f.writelines(new_lines)
                                cleaned_files.add(abs_p)
                        except Exception as fe:
                            pass

            # 3. Remove physical tag document if exists
            tag_md_p = os.path.join(rp, ".docgraphical", "tags", f"{concept_name}.md")
            if os.path.exists(tag_md_p):
                try:
                    os.remove(tag_md_p)
                except Exception:
                    pass

            # 4. Remove from SQLite tables
            cur.execute("""
                DELETE FROM edges 
                WHERE (target = ? OR target = ? OR source = ? OR source = ?) AND kind = 'wiki_link'
            """, (cid, concept_name, cid, concept_name))
            cur.execute("DELETE FROM nodes WHERE id = ? OR id = ?", (cid, concept_name))
            cur.execute("DELETE FROM concepts WHERE name = ?", (concept_name,))
            cur.execute("DELETE FROM concept_exclusions WHERE concept_name = ?", (concept_name,))
            conn.commit()

            # 5. Re-index affected files and topology
            md_files = _FnWalkDocFiles(rp)
            _FnRebuildDocLinks(cur, rp, md_files)
            conn.commit()
            _FnSyncGlobalIndex(cur, rp)
        finally:
            conn.close()

    return {"ok": True, "concept": concept_name, "cleaned_files_count": len(cleaned_files)}
