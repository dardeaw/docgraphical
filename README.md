# DocGraphical

A deterministic Markdown Abstract Syntax Tree (AST) analyzer and surgical section slicer designed for LLM coding agents, RAG pipelines, and developer documentation workflows.

---

## Overview

When Large Language Model (LLM) coding agents (such as Claude Code, Cursor, Windsurf, or Antigravity) inspect extensive Markdown files (e.g., product requirement documents, architecture specifications, design systems), standard tooling typically loads entire files into the model's context window.

This approach introduces several practical challenges:

1. **Context Window Saturation**: Reading large multi-thousand-line documents consumes 10,000 to 40,000 tokens per interaction, accelerating context exhaustion and driving up operational inference costs.
2. **Context Dilution ("Lost in the Middle")**: Flooding the context window with unrelated sections reduces attention density on target instructions, increasing the likelihood of hallucination.
3. **Imprecise RAG Chunking**: Naive fixed-size text splitters frequently sever code fences, mathematical formulas, and hierarchical heading relationships.

**DocGraphical** addresses these issues through AST-aware Markdown analysis:

- **Outline First (TOC Extraction)**: Extracts hierarchical headings with exact line anchors (~30 to 50 tokens), allowing agents to pinpoint target sections before reading.
- **Surgical Section Slicing**: Slices the exact boundary of a requested section (including all child sub-headings and code blocks) without reading preceding or succeeding chapters (~100 to 300 tokens).
- **Fenced Code Block Protection**: Guarantees that hash symbols (`#`) inside code blocks (e.g., Python comments, Bash scripts) are never misinterpreted as headings.
- **Knowledge Graph & Cross-Reference Mapping**: Maps relationships and cross-document markdown links into a lightweight local SQLite graph database (`.docgraphical/docgraphical.db`).
- **Model Context Protocol (MCP) Native**: Exposes standard tools for automated integration with MCP-compatible agent environments.

---

## Token Economy Comparison

| Operation | Traditional File Read | Vector / Naive Splitter | DocGraphical (AST Slice) |
| :--- | :--- | :--- | :--- |
| **Inspect 1,500-line Spec** | ~18,000 tokens | ~2,500 tokens (lossy) | **~150 tokens** |
| **Hierarchy Preservation** | Full (High Token Cost) | Fragmented | **Strict AST Maintained** |
| **Code Block Integrity** | Full | Frequently Severed | **Guaranteed Intact** |
| **Context Noise** | High | Medium | **Zero Irrelevant Text** |
| **Token Savings** | 0% | ~85% | **~97%** |

---

## Installation

### Python Package (CLI & Library)

```bash
# Basic installation
pip install docgraphical

# Installation with MCP server support
pip install "docgraphical[mcp]"
```

### Node.js / Desktop Application

```bash
# Global CLI via npm
npm install -g docgraphical

# Run Desktop Studio locally
git clone https://github.com/dardeaw/docgraphical.git
cd docgraphical
npm install
npm start
```

---

## Quick Start (CLI)

Both `docgraphical` and the short alias `docg` are supported:

### 1. Extract Table of Contents (TOC)

Generates a compact outline with line numbers for any Markdown file:

```bash
docgraphical toc docs/architecture.md
# Or using short alias:
docg toc docs/architecture.md
```

Output:
```text
=== [DocGraphical TOC] architecture.md ===
[Line    1] # Architecture Overview
[Line   24]   ## 1. Storage Subsystem
[Line   58]     ### 1.1 Write-Ahead Logging (WAL)
[Line  112]     ### 1.2 LSM-Tree Compaction
[Line  180]   ## 2. Distributed Consensus Protocol
[Line  245]   ## 3. Network Transport Layer
```

JSON format is also supported for programmatic agent workflows:
```bash
docg toc docs/architecture.md --format json
```

### 2. Surgically Slice a Section

Extracts only the specified chapter and stops precisely before the next heading of equal or higher rank:

```bash
docg section docs/architecture.md "1. Storage Subsystem"
```

To extract only the heading body without its child sub-sections:
```bash
docg section docs/architecture.md "1. Storage Subsystem" --no-subsections
```

### 3. Search Keywords Across Documents

Searches documentation with exact line numbers and contextual snippets:

```bash
docg search docs/ "compaction"
```

### 4. Build Repository Knowledge Graph

Scans a repository, parses all Markdown files into AST nodes and cross-document links, and stores the graph in `.docgraphical/docgraphical.db`:

```bash
docg index .
```

### 5. Launch Web Studio

Starts the local HTTP server and opens the visual inspection interface:

```bash
docg serve --port 5002
```

---

## Model Context Protocol (MCP) Integration

DocGraphical provides native support for the Model Context Protocol (MCP), allowing AI agents to query documentation structures via standard stdio JSON-RPC.

### Configuration (`mcp_config.json` / Claude Desktop / Cursor / Antigravity)

```json
{
  "mcpServers": {
    "docgraphical": {
      "command": "python",
      "args": ["-m", "docgraphical.cli", "mcp"]
    }
  }
}
```

### Available MCP Tools

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `docgraphical_toc` | `filePath` (string), `format` (text/json) | Returns heading outline with line numbers (~30 tokens). |
| `docgraphical_section` | `filePath` (string), `heading` (string), `includeSubsections` (bool) | Extracts verbatim content of target section (~100 tokens). |
| `docgraphical_search` | `filePath` (string), `query` (string), `limit` (int) | Fast regex-based keyword search within file or directory. |
| `docgraphical_graph` | `repoPath` (string) | Returns AST node graph and cross-document link relations. |
| `docgraphical_index` | `repoPath` (string) | Refreshes and rebuilds the SQLite AST index for a repository. |

---

## Python API Reference

DocGraphical can be imported directly into Python applications and automated scripts:

```python
from docgraphical.parser import parse_headings, extract_toc, extract_section, search_file

# 1. Parse AST Headings
headings = parse_headings("docs/spec.md")
for h in headings:
    print(f"L{h['line']} [{h['level']}] {h['title']}")

# 2. Extract TOC
toc_text = extract_toc("docs/spec.md", output_format="text")
print(toc_text)

# 3. Surgically Slice Section
section_content = extract_section("docs/spec.md", target_heading="1. Storage Subsystem")
print(section_content)

# 4. Search File
matches = search_file("docs/spec.md", query="LSM-Tree")
for m in matches:
    print(f"Line {m['line']}: {m['content']}")
```

---

## Architecture & Design Principles

DocGraphical is built upon the following core design principles:

1. **Zero External Runtime Dependencies (Core Library)**: The core parser and scanner rely solely on standard Python libraries (`re`, `sqlite3`, `pathlib`), ensuring zero friction for enterprise and air-gapped environments.
2. **State Machine AST Parsing**: Markdown documents are processed through a line-by-line state machine that tracks fenced code block states (```` ``` ```` and `~~~`), preventing false positive heading detections.
3. **Deterministic Section Boundary Slicing**: Slicing calculates exact line offsets based on AST heading depth rather than heuristic text matching.
4. **Relational Graph Storage**: Nodes (Files, H1-H6 Headings) and Edges (Parent-Child containment, Markdown hyperlinks) are indexed into SQLite with B-Tree indices for sub-millisecond graph queries.

---

## Repository Structure

```text
docgraphical/
├── docgraphical/           # Python core package
│   ├── __init__.py         # Package entry & exports
│   ├── cli.py              # CLI argument parser (docgraphical / docg)
│   ├── config.py           # Path & environment configuration
│   ├── constants.py        # AST node kinds & edge types
│   ├── db.py               # SQLite schema & query engine
│   ├── mcp_server.py       # Model Context Protocol stdio server
│   ├── parser.py           # Markdown AST parser & section slicer
│   ├── scanner.py          # Multi-document repository scanner
│   └── server.py           # Web Studio HTTP server
├── electron/               # Desktop application wrapper
│   ├── main.js             # Electron main process
│   └── preload.js          # Secure context bridge
├── static/                 # Web Studio assets
│   ├── docgraph.js         # Frontend graph controller
│   └── galaxy.css          # Visual theme & layout
├── templates/              # Jinja2 web templates
│   └── index.html          # Web Studio interface
├── tests/                  # Unit & integration test suite
│   └── test_docgraphical.py # Pytest test cases
├── pyproject.toml          # Python build & dependency metadata
├── package.json            # Node.js & Electron configuration
├── LICENSE                 # MIT License
└── README.md               # Project documentation
```

---

## Contributing

Contributions are welcome. Please refer to [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on code formatting, running test suites, and submitting pull requests.

---

## License

DocGraphical is open-source software licensed under the [MIT License](LICENSE).
