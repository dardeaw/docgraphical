"""DocGraph SQLite Indexing & Graph Storage Engine.
Stores Markdown files, heading AST nodes, cross-document links, and FTS fulltext search
inside <project_root>/.docgraph/docgraph.db.
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
    dot_dir = os.path.join(os.path.abspath(repo_path), ".docgraph")
    os.makedirs(dot_dir, exist_ok=True)
    return os.path.join(dot_dir, "docgraph.db")

def init_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    return conn

def compute_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()

def index_repository(repo_path: str) -> Tuple[int, int, int]:
    repo_path = os.path.abspath(repo_path)
    db_path = get_db_path(repo_path)
    conn = init_db(db_path)
    cur = conn.cursor()

    md_files: List[str] = []
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]
        for f in files:
            if f.lower().endswith(DOC_EXTS):
                md_files.append(os.path.join(root, f))

    cur.execute("DELETE FROM edges;")
    cur.execute("DELETE FROM nodes;")
    cur.execute("DELETE FROM files;")
    try:
        cur.execute("DELETE FROM nodes_fts;")
    except Exception:
        pass

    total_nodes = 0
    total_edges = 0
    pending_edges: List[Tuple[str, str, str, str, int]] = []

    for file_path in md_files:
        rel_path = os.path.relpath(file_path, repo_path).replace("\\", "/")
        try:
            stat = os.stat(file_path)
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
                lines = content.splitlines(keepends=True)
        except Exception:
            continue

        c_hash = compute_hash(content)
        cur.execute(
            "INSERT INTO files VALUES (?, ?, ?, ?, ?)",
            (rel_path, c_hash, stat.st_size, stat.st_mtime, 0)
        )

        file_node_id = f"file::{rel_path}"
        file_tokens = math.ceil(len(content) / 3.8)

        cur.execute(
            "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (file_node_id, rel_path, "file", os.path.basename(rel_path), 0, 1, len(lines), file_tokens, content)
        )
        total_nodes += 1

        heading_stack: List[Tuple[int, str]] = [(0, file_node_id)]
        headings_in_file = 0

        for idx, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith("```") or stripped.startswith("~~~"):
                continue

            m = re.match(r"^(#{1,6})\s+(.+)$", stripped)
            if m:
                level = len(m.group(1))
                title = m.group(2).strip()
                title = re.sub(r"\s+#+$", "", title)
                node_id = f"heading::{rel_path}::L{idx}::{title[:30]}"
                headings_in_file += 1

                # Extract section preview snippet
                sec_lines = [line]
                for nxt in range(idx, min(len(lines), idx + 20)):
                    sec_lines.append(lines[nxt])
                sec_content = "".join(sec_lines)

                cur.execute(
                    "INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (node_id, rel_path, f"heading_{level}", title, level, idx, idx, math.ceil(len(sec_content)/3.8), sec_content)
                )
                total_nodes += 1

                while heading_stack and heading_stack[-1][0] >= level:
                    heading_stack.pop()

                parent_id = heading_stack[-1][1] if heading_stack else file_node_id
                edge_id = f"edge::{parent_id}->{node_id}"
                pending_edges.append((edge_id, parent_id, node_id, "parent_child", idx))
                total_edges += 1

                heading_stack.append((level, node_id))

        cur.execute("UPDATE files SET node_count = ? WHERE path = ?", (headings_in_file + 1, rel_path))

        # Check for cross-file links
        link_matches = re.finditer(r"\[([^\]]+)\]\(([^)]+\.(?:md|markdown|mdown))(?:\#([^)]+))?\)", content)
        for lm in link_matches:
            target_link = lm.group(2).strip().replace("\\", "/")
            current_dir = os.path.dirname(rel_path)
            target_rel = os.path.normpath(os.path.join(current_dir, target_link)).replace("\\", "/")
            link_edge_id = f"link::{file_node_id}->{target_rel}::{lm.start()}"
            pending_edges.append((link_edge_id, file_node_id, f"file::{target_rel}", "doc_link", 0))
            total_edges += 1

    for e in pending_edges:
        cur.execute("INSERT OR IGNORE INTO edges VALUES (?, ?, ?, ?, ?)", e)

    try:
        cur.execute("INSERT INTO nodes_fts(id, name, content) SELECT id, name, content FROM nodes;")
    except Exception:
        pass

    conn.commit()
    conn.close()
    return len(md_files), total_nodes, total_edges

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
        "file": "#f0883e",       # File Orange (Galaxy Mode 1)
        "heading_1": "#58a6ff",  # H1 Function Blue (Galaxy Mode 2)
        "heading_2": "#3fb950",  # H2 Class Green (Galaxy Mode 3)
        "heading_3": "#bc8cff",  # H3 Import Purple (Galaxy Mode 4)
        "heading_4": "#d29922",  # H4 Variable Gold (Galaxy Mode 5)
        "heading_5": "#79c0ff",
        "heading_6": "#a5d6ff",
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
