# DocGraph Architecture & Design Specification

This document outlines the internal architecture, algorithmic design, and data structures of DocGraph.

---

## System Overview

```text
+-----------------------------------------------------------------------------+
|                               DocGraph Engine                               |
+-----------------------------------------------------------------------------+
                                       |
    +----------------------------------+----------------------------------+
    |                                  |                                  |
    v                                  v                                  v
+---------------------+      +---------------------+      +---------------------+
|   Core AST Parser   |      |  Graph Persistence  |      |   Interface Layer   |
|   (docgraph.parser) |      |   (docgraph.db)     |      |  (CLI / MCP / Web)  |
+---------------------+      +---------------------+      +---------------------+
    |                                  |                                  |
    |-- State Machine Parsing          |-- SQLite Schema (B-Tree)         |-- Stdio MCP Protocol
    |-- Fenced Code Protection         |-- Node & Edge Topology           |-- CLI Subcommands
    |-- Surgical Slicing Algorithm     |-- Bidirectional Link Map         |-- 3D Web Studio
```

---

## 1. Core AST Parser (`docgraph.parser`)

The parser operates as a deterministic line-by-line streaming state machine.

### 1.1 Fenced Code Block State Machine

To prevent markdown headings inside code blocks from being falsely recognized:
- Tracks opening and closing code fences matching `^\s*(```|~~~)`
- While inside an active code fence, all heading regex patterns are ignored.

### 1.2 Heading Level Hierarchy

Headings matching `^(#{1,6})\s+(.+)$` are extracted with:
- `level`: Integer depth from 1 (`#`) to 6 (`######`).
- `title`: Sanitized text heading without trailing hashes or formatting tags.
- `line`: 1-based exact line index in source file.

### 1.3 Deterministic Section Slicing Algorithm

Given `target_heading` and `include_subsections`:
1. Find the target heading node $H_t$ with depth $L_t$.
2. Define start line $S = 	ext{line}(H_t)$.
3. Scan subsequent headings until finding the first heading $H_e$ such that:
   - If `include_subsections == True`: $	ext{level}(H_e) \le L_t$.
   - If `include_subsections == False`: $	ext{level}(H_e) \le L_t + 1$.
4. Define end line $E = 	ext{line}(H_e) - 1$, or end of file if no terminating heading is encountered.
5. Return lines $[S, E]$ verbatim.

---

## 2. Graph Persistence & Schema (`docgraph.db`)

DocGraph indexes documentation into a local SQLite database (`.docgraph/docgraph.db`).

### 2.1 Nodes Table

```sql
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,         -- 'file' | 'heading_1' | ... | 'heading_6'
    file TEXT NOT NULL,
    line INTEGER NOT NULL,
    level INTEGER,              -- NULL for 'file', 1..6 for headings
    project TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project);
```

### 2.2 Edges Table

```sql
CREATE TABLE IF NOT EXISTS edges (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    kind TEXT NOT NULL,         -- 'parent_child' | 'doc_link'
    PRIMARY KEY (source, target, kind)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
```

---

## 3. Model Context Protocol (MCP) Server

The MCP server implements the official JSON-RPC protocol over `stdio`:
- Handles `tools/list` to register `docgraph_toc`, `docgraph_section`, `docgraph_search`, `docgraph_graph`, and `docgraph_index`.
- Handles `tools/call` with strict validation and formatted responses.

---

## 4. Visual 3D Web Studio

The dual-pane visual interface (`templates/index.html`, `static/docgraph.js`, `static/galaxy.css`) combines:
- **Left Explorer Tree**: Hierarchical project and folder tree with collapsible file headings.
- **Center Document Viewer**: Synchronized Markdown and raw source viewer with bidirectional jump.
- **Right 3D Force Graph**: WebGL 3D graph visualizer with AST layer filtering and real-time relationship tracking.
