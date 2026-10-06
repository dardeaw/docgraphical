# DocGraphical

[English](README.md) | [繁體中文](README.zh-TW.md)

A personal and team **Knowledge Management (KM) platform**: turn knowledge scattered across PDF / PPT / Word / Markdown into an accumulable, citable, conversable deterministic knowledge base. The foundation is a deterministic Markdown AST parser with a surgical slicing engine; on top sit the document ingest pipeline, a 3D knowledge map, MCP tools, and a (planned) AI chat panel.

> Master plan: [`PLAN.zh-TW.md`](PLAN.zh-TW.md) (KM Master Plan — four dogmas, target architecture, Phase 0–5, in Traditional Chinese).

---

## Why knowledge management, not RAG

Traditional RAG re-derives everything from raw documents on every query — zero accumulation; vector chunking further severs heading hierarchies and code blocks, serving lossy fragments. DocGraphical takes the other road (referencing Andrej Karpathy's *LLM Wiki* idea while fixing its weakest link):

| Dimension | Karpathy LLM Wiki | DocGraphical |
|---|---|---|
| Accumulation | LLM hand-maintains wiki prose | **Code-written index** (parser/scanner/SQLite), reproducible |
| Retrieval | LLM reads synthetic prose (lossy middleman) | **Deterministic CPU lookup**: heading path + line numbers, zero tokens, zero fuzz |
| Citation granularity | Page-level links | **Heading-level + char/line offsets** |
| Failure mode | Silent rot (hence lint) | Structural failures shout (parser/tests); cache invalidated by fingerprint |
| LLM role | Owns and maintains knowledge | **Reads only human-confirmed source slices** |

In one line: **CPU decides which cuts to read; the LLM only reads those cuts into answers** — no sourcing, no memorizing, no maintaining.

---

## Four dogmas (iron laws)

1. **Locate on CPU first, read with LLM second** — retrieval is deterministic code; the LLM never searches, only reads.
2. **Feed source text** — the LLM reads hit source slices, never a lossy middleman.
3. **Synthesis is slice aggregation** — cross-document questions = search aggregates N precise slices → one read-through answer with N citations.
4. **Humans rule on hits** — ask/browse (CPU search) → inspect hits (human eyes judge) → confirm (human switch) → read originals (burn compute only now).

---

## What works today

### 📥 Document ingest pipeline (Explorer right-click → ＋ New document…)
- **Drag & drop upload** for Office/PDF (ppt/pptx/doc/docx/pdf); files stage until confirm, then land with the summary
- **One-click summarize**: upload → LLM summary → preview/edit → confirm, fully chained; filename auto-follows
- **Vision for image-only docs**: zero-text scanned PDFs / image PPTs route to a vision model automatically (needs a vision model, e.g. gpt-5 series)
- Summary md lives **next to its sources**, header mandatorily records source relative paths, save triggers incremental index
- Human-readable errors for encrypted PDFs / corrupt files / legacy binaries — one bad file never kills the batch

### 🌳 Knowledge tree (Explorer)
- Four levels: project / folder / md / heading, long names truncated with hover, file-count badges
- Inline **＋** on folder rows (new document) / inline **−** on md rows (delete md + sources + index, with confirm)
- Right-click menu: new document, **new folder** (empty dirs visible too), copy absolute path, locate in graph, sync
- **👁 Source toggle** (default ON): each source hangs under its own md; orphans recorded in no md header are hidden
- Live filter box (with ancestor expansion), ⚡ Sync all incremental sync, empty-repo auto-guide

### 📖 Markdown viewer
- Source lines are **clickable links** (PDF renders inline, Office downloads); right-click menu: copy selection / copy section / copy for Agent / open source / copy source paths
- Full-area drag-select + Ctrl+C; heading clicks are true slices (top-right savings badge is real), honest 404/stale-node notices

### 🗄️ Deterministic foundation (unchanged)
- `parser.py` (AST/state machine, fenced-code protection), `scanner.py` (traversal/relations), `db.py` (SQLite index)
- MCP stdio five tools: `toc / section / search / graph / index` for external agents
- REST API: `/api/browse` + `/api/browse/mkdir`, `/api/ingest/{upload,summarize,save,delete,source}`, `/api/sync*`, `/api/doc/section` (slicing + `full_chars` true denominator)
- 3D knowledge map (screen-space flight, pole guards), Electron copy byte-synced with web

---

## Target architecture

```text
DocGraphical Web (knowledge management UI)
[3D knowledge map] [TOC reading] [candidate-hit list] [AI chat panel] <- planned
              ^ Dogma 4: human gate (chat about this section)
Dialogue backend = tool loop (planned M1: three governed tools)
MCP knowledge layer (existing: toc / section / search / graph / index)
Deterministic foundation (existing: parser / scanner / db)
Raw originals (immutable raw layer: md / pdf / ppt / word)
```

---

## Roadmap (see PLAN §7)

| Phase | Content | Status |
|---|---|---|
| Phase 0 decisions | LLM endpoint (O1), hard-link semantics (O4), KB location (O5) | ⏳ Pending |
| Phase 1 multi-format ingest (M5) | CPU extract → LLM summarize → store → rescan; web dialog landed | 🚧 In progress |
| Phase 2 dialogue backend (M1) | `/api/chat` SSE + tool loop + human gate | ⬜ Not started |
| Phase 3 chat UI (M2+M3) | chat-about-this-section, candidate list, streaming panel, citation jumps | ⬜ Not started |
| Phase 4 slice-aggregation QA | Cross-doc search → aggregate → one read-through answer (dogma 3) | ⬜ Not started |
| Phase 5 wiki cache layer (M4, stage 2) | Answer write-back + fingerprint invalidation + lint-lite | ⬜ Stage 2 |

**Explicitly not doing**: vector embeddings / fuzzy semantic retrieval, LLM-maintained prose truth layer, whole-corpus automatic RAG QA, rushing a GitHub release.

---

## Installation

### Python Package (CLI & Library)

```bash
# Basic installation
pip install docgraphical

# Installation with MCP server support
pip install "docgraphical[mcp]"
```

### Node.js & Desktop App

```bash
# Install CLI globally via npm
npm install -g docgraphical

# Launch the desktop Studio locally
git clone https://github.com/dardeaw/docgraphical.git
cd docgraphical && npm install && npm run start
```

---

## Quick Start (CLI)

### 1. Extract Outline (TOC)

```bash
# Hierarchical outline with line numbers
docg toc docs/spec.md

# Or the short alias:
docg t docs/spec.md
```

**Example output**:

```text
# TOC: docs/spec.md

- [H1] 1. Storage Subsystem (L1)
  - [H2] 1.1 LSM-Tree Architecture (L15)
    - [H3] 1.1.1 Write Path (L23)
  - [H2] 1.2 Read Path (L45)
```

### 2. Slice a Section Surgically

```bash
# Slice one section (with children)
docg slice docs/spec.md --heading "1.1 LSM-Tree Architecture"

# Include subsections and code blocks
docg slice docs/spec.md --heading "1. Storage Subsystem" --sub
```

### 3. Precise Keyword Search

```bash
# Cross-file search (returns heading path + line numbers)
docg search ./docs --query "LSM-Tree"
```

### 4. Build the Knowledge Graph Index

```bash
# Scan a directory into the SQLite index (with cross-doc links)
docg index ./docs
```

### 5. Launch the Web Studio & 3D Galaxy

```bash
# Flask + WebGL studio (default http://127.0.0.1:5002)
python -m docgraphical.server
```

---

## 3D Visual Knowledge Map

A WebGL force-directed-graph studio: slot-based view swap (doc ↔ 3D), nearest-ancestor centering, dynamic SpriteText shrines, screen-space flight (E up / Q down), blur auto-clears keys. Every map node jumps back to its source line.

---

## Model Context Protocol (MCP) Integration

### Setup (`mcp_config.json` / Claude Desktop / Cursor / Antigravity)

```json
{
  "mcpServers": {
    "docgraphical": {
      "command": "python",
      "args": ["-m", "docgraphical.mcp_server"],
      "cwd": "/path/to/your/docs"
    }
  }
}
```

### Supported MCP Tools

| Tool | Description |
| :--- | :--- |
| `docgraphical_toc` | Extract hierarchical document outline |
| `docgraphical_section` | Slice a section surgically |
| `docgraphical_search` | Keyword search (heading path + line numbers) |
| `docgraphical_graph` | Query knowledge-graph relations |
| `docgraphical_index` | Build / update the index |

---

## Python API Example

```python
from docgraphical.parser import parse_headings, extract_toc, extract_section, search_file

# 1. Parse AST heading list
headings = parse_headings("docs/spec.md")
for h in headings:
    print(f"L{h['line']} [{h['level']}] {h['title']}")

# 2. Extract TOC outline
toc_text = extract_toc("docs/spec.md", output_format="text")
print(toc_text)

# 3. Slice a target section
section_content = extract_section("docs/spec.md", target_heading="1. Storage Subsystem")
print(section_content)

# 4. Search file contents
matches = search_file("docs/spec.md", query="LSM-Tree")
for m in matches:
    print(f"Line {m['line']}: {m['content']}")
```

---

## Node.js API Example

```javascript
const { parseHeadings, extractToc, extractSection, searchDoc } = require('docgraphical');

// 1. Extract outline
const toc = extractToc('docs/spec.md');
console.log(toc);

// 2. Slice a section surgically
const slice = extractSection('docs/spec.md', '1. Storage Subsystem', { includeSubsections: true });
console.log(slice);
```

---

## Architecture & Design Principles

1. **Zero Dependencies at Core**: the core parser uses only the standard library (`re`, `sqlite3`, `pathlib`), fitting any enterprise or air-gapped environment.
2. **State-Machine Parsing**: tracks fenced code blocks (```` ``` ```` and `~~~`) line by line — comment markers are never mistaken for headings.
3. **Deterministic Boundaries**: line boundaries computed from AST depth, never fragile heuristics.
4. **Graph Database Storage**: files, H1–H6 headings, and links in SQLite with B-Tree indexes for sub-millisecond graph queries.
5. **Dogma over cleverness**: every LLM feature must pass the four dogmas — CPU first, source-text feeding, slice aggregation, human verdict.

---

## Development Status

- Iterating locally, **no rush for a GitHub release** (see PLAN §8).
- Web studio (port 5002 main DB / 5003 clean instance) + Electron desktop copy (`app/`, byte-synced).
- Open issues (O1–O5) and acceptance criteria: see [`PLAN.zh-TW.md`](PLAN.zh-TW.md) §7, §9.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.zh-TW.md](CONTRIBUTING.zh-TW.md) for code standards, test runs, and the PR process.

---

## License

DocGraphical is released under the [MIT License](LICENSE) for free personal and commercial use.
