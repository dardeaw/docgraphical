# DocGraphical Architecture Specification

This document provides a comprehensive technical overview of the internal architecture, parsing algorithms, data models, and component interactions within DocGraphical.

---

## System Architecture Overview

DocGraphical operates on a layered, modular architecture designed for high throughput, deterministic parsing, and minimal resource utilization.

```text
+-------------------------------------------------------------------+
|                        Client Interfaces                          |
|  [CLI (docg)]  [MCP Stdio Server]  [Web Studio]  [Electron App]   |
+-------------------------------------------------------------------+
                                  |
+-------------------------------------------------------------------+
|                         Core API Layer                            |
|       parser.py        scanner.py        db.py        server.py   |
+-------------------------------------------------------------------+
                                  |
+-------------------------------------------------------------------+
|                     Deterministic AST Engine                      |
|  - State-Machine Fenced Code Block Tracking                       |
|  - Strict Line Anchor Indexing                                    |
|  - Surgical Subtree Boundary Resolution                           |
+-------------------------------------------------------------------+
                                  |
+-------------------------------------------------------------------+
|                     Persistence & Graph Layer                     |
|           SQLite Database (.docgraphical/docgraphical.db)         |
|     [AST Nodes Table]    [Cross-Doc Relations]    [B-Tree Index]  |
+-------------------------------------------------------------------+
```

---

## Core Component Responsibilities

### 1. Parser Engine (`docgraphical/parser.py`)
- **State Machine**: Tracks Markdown line states to guarantee code block isolation.
- **Heading Extractor**: Identifies ATX (`#`) and Setext (`===`, `---`) headings with 1-based line anchors.
- **Section Slicer**: Computes the exact span `[StartLine, EndLine)` for any targeted heading.

### 2. Scanner & Graph Builder (`docgraphical/scanner.py`)
- **Directory Traversal**: Walks project directories while respecting `.gitignore` and default exclusions.
- **Link Extractor**: Discovers Markdown hyperlinks (`[label](path.md#heading)`) and wiki-links (`[[target]]`).
- **AST Hierarchy Generation**: Connects Document root nodes to Top-Level Sections (H1) and nested sub-sections (H2-H6).

### 3. Database Layer (`docgraphical/db.py`)
- Manages connection lifecycle and migrations for `.docgraphical/docgraphical.db`.
- Implements parameterized SQL queries for node retrieval, edge traversal, and full-text keyword indexing.

### 4. Model Context Protocol Server (`docgraphical/mcp_server.py`)
- Implements the JSON-RPC 2.0 protocol over `stdin`/`stdout`.
- Exposes tools: `docgraphical_toc`, `docgraphical_section`, `docgraphical_search`, `docgraphical_graph`, and `docgraphical_index`.

### 5. Web & Visual Studio (`static/docgraph.js`, `templates/index.html`)
- Provides 3D WebGL Force-Directed visualization powered by Three.js.
- Implements slot-based dynamic component swapping, immediate ancestor camera focus, and SpriteText billboard rendering.

---

## Deterministic Section Slicing Algorithm

The slicing algorithm guarantees precision through the following execution steps:

1. **Tokenize Document**: Parse the file into an ordered list of heading AST descriptors:
   $$\mathcal{H} = \{ (l_1, d_1, t_1), (l_2, d_2, t_2), \dots, (l_n, d_n, t_n) \}$$
   where $l_i$ denotes the line number, $d_i \in [1, 6]$ denotes heading depth, and $t_i$ denotes the normalized title string.

2. **Locate Target Anchor**: Find index $k$ such that $t_k = 	ext{TargetTitle}$.

3. **Compute Boundary**:
   - $	ext{StartLine} = l_k$
   - If `includeSubsections = True`: Find the first subsequent heading $j > k$ such that $d_j \le d_k$.
     $$	ext{EndLine} = egin{cases} l_j - 1 & 	ext{if such } j 	ext{ exists} \ 	ext{TotalDocumentLines} & 	ext{otherwise} \end{cases}$$
   - If `includeSubsections = False`: Find the immediate next heading $j = k + 1$.
     $$	ext{EndLine} = egin{cases} l_{k+1} - 1 & 	ext{if } k+1 \le n \ 	ext{TotalDocumentLines} & 	ext{otherwise} \end{cases}$$

4. **Verbatim Slice**: Extract lines $	ext{Lines}[	ext{StartLine} : 	ext{EndLine}]$ without post-processing or re-encoding.
