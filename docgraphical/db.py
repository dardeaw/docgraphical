"""DocGraphical SQLite Indexing & Graph Storage Engine.
Stores Markdown files, heading AST nodes, cross-document links, and FTS fulltext search
inside <project_root>/.docgraphical/docgraphical.db.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple
from .constants import IGNORE_DIRS, DOC_EXTS

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
    """Parse ONE markdown file into files/nodes rows + parent_child edges + FTS row."""
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

    for idx, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
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
    cur.execute("SELECT count(*) FROM nodes")
    n_nodes = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM edges")
    n_edges = cur.fetchone()[0]
    conn.close()
    return {"files": len(md_files), "parsed": len(to_parse),
            "skipped": len(md_files) - len(to_parse), "removed": len(vGone),
            "nodes": n_nodes, "edges": n_edges,
            "incremental": bool(not b_full)}


def fetch_graph_data(repo_path: str) -> Dict[str, Any]:
    repo_path = os.path.abspath(repo_path)
    db_path = get_db_path(repo_path)
    if not os.path.exists(db_path):
        index_repository(repo_path)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("SELECT id, name, kind, level, start_line, end_line, token_estimate, file_path, content FROM nodes;")
    rows = cur.fetchall()

    nodes = []
    KIND_COLORS = {
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
