# DocGraphical

[English](README.md) | [繁體中文](README.zh-TW.md)

[![CI](https://github.com/dardeaw/docgraphical/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dardeaw/docgraphical/actions/workflows/ci.yml)

A personal and team **Knowledge Management (KM) platform**: turn knowledge scattered across PDF / PPT / Word / Markdown into an accumulable, citable, conversable deterministic knowledge base. The foundation is a deterministic Markdown AST parser with a surgical slicing engine; on top sit the document ingest pipeline, a 3D knowledge map, MCP tools, an AI conversation panel grounded in verbatim slices, and a prompt manager for every LLM call.

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

### Document ingest pipeline (Explorer right-click → ＋ New document…)
- **Drag & drop upload** for Office/PDF (ppt/pptx/doc/docx/pdf); files stage until confirm, then land with the summary
- **One-click summarize**: upload → LLM summary → preview/edit → confirm, fully chained; filename auto-follows
- **Vision for image-only docs**: zero-text scanned PDFs / image PPTs route to a vision model automatically (needs a vision model, e.g. gpt-5 series)
- Summary md lives **next to its sources**, header mandatorily records source relative paths, save triggers incremental index
- Human-readable errors for encrypted PDFs / corrupt files / legacy binaries — one bad file never kills the batch

### Knowledge tree (Explorer)
- Four levels: project / folder / md / heading, long names truncated with hover, file-count badges
- Inline **＋** on folder rows (new document) / inline **−** on md rows (delete md + sources + index, with confirm)
- Right-click menu: new document, **new folder** (empty dirs visible too), copy absolute path, locate in graph, sync
- **Source toggle** (default ON): each source hangs under its own md; orphans recorded in no md header are hidden
- Live filter box (with ancestor expansion), Sync all incremental sync, empty-repo auto-guide

### Markdown viewer
- Source lines are **clickable links** (PDF renders inline, Office downloads); right-click menu: copy selection / copy section / copy for Agent / open source / copy source paths
- Full-area drag-select + Ctrl+C; heading clicks are true slices (top-right savings badge is real), honest 404/stale-node notices

### Deterministic foundation (unchanged)
- `parser.py` (AST/state machine, fenced-code protection), `scanner.py` (traversal/relations), `db.py` (SQLite index)
- MCP stdio five tools: `toc / section / search / graph / index` for external agents
- REST API: `/api/browse` + `/api/browse/mkdir`, `/api/ingest/{upload,summarize,save,delete,source}`, `/api/sync*`, `/api/doc/section` (slicing + `full_chars` true denominator)
- 3D knowledge map (screen-space flight, pole guards), Electron copy byte-synced with web

### Concept layer (Prospect + Vine) — v1.5.0
- **Two miners, one pool**: Prospect (corpus frequency: DF/TF recount with mtime-fingerprint cache, one LLM review per round) and Vine (user seed + DFS stack-walk, batched at 5 files per LLM call) propose candidates; **nothing touches disk until a human promotes**
- **Staged, then human-ruled**: candidates accumulate in `staged_items` with file/heading evidence; draft review pages carry a preview banner plus a dashed preview of the exact tag line to be written; Promote writes inline links + section tag lines + `tags/<Name>.md`, Remove/Blacklist never writes
- **Crawler guardrails proven in production**: per-call `max_completion_tokens` caps (gpt-5 series rejects legacy `max_tokens`), 150 s total hard deadline with fuse-and-requeue (a timed-out batch retries once, skips after two consecutive failures), LIFO drain livelock fixed, per-stage trace log
- **Viewer navigation**: browser-like back/forward across document, section, tag, and draft pages, restored through the same selection entry points (explorer + 3D + viewer stay synced)
- REST API: `/api/concepts/scan*` (mine/review/confirm/blacklist), `/api/crawl/{start,next,finish,confirm,refresh}` (runs live in server memory), `/api/concepts/candidates/draft` (evidence groups)

### Document Ingestion & Knowledge Topology Compound — v3.0.1
- **Omni-Channel Multi-Format Ingestion**:
  - **Full Document Support**: PDF, PowerPoint (`.ppt`, `.pptx`), Word (`.doc`, `.docx`), spreadsheets (`.csv`), HTML web files (`.html`, `.htm`), emails (`.eml`), and plain text (`.txt`, `.md`).
  - **One-Click Web Crawling Ingest**: Input any HTTP/HTTPS URL to automatically fetch web page contents, strip scripts/ads/navigation, extract pure article bodies and titles, and convert them directly into structured knowledge Markdown.
  - **Hybrid Multimodal Summarization**: Mix clipboard text or document sections with images/screenshots in a single ingest pass. Powered by vision models, DocGraphical correlates diagram backdrops with technical text and embeds relative image links directly into the resulting Markdown note.
- **Pass-2 Compound Ingest**:
  - During document summarization, DocGraphical automatically runs a secondary concept comparison against the current knowledge graph, surfacing matching official concepts and mined candidate terms for human review via interactive pills.
- **Embedded Image & Attachment Indexing**:
  - The indexing engine automatically parses `![Alt Text](Path)` tags and filenames in Markdown; the MCP chat engine automatically inspects and surfaces document attachments to prevent blind spots when querying images.

### Knowledge Library Linting & Governance — v3.0.1
- **Sub-second deterministic health audit**: Dedicated Linting drawer provides a comprehensive Knowledge Health Score (0–100) on demand.
- **Five structural inspection dimensions**: Orphan documents, broken links, circular references, empty sections, and unindexed/outdated concept definitions.
- **One-click surgical navigation**: Pinpoint issues directly by line number with instant jumps to the Markdown viewer and 3D graph locator.

### Prompts Manager & Internationalization — v3.0.0
- **Prompt template curation**: Full customizable prompts drawer panel for concept mining, vine crawling (seed/file/finish), and document ingestion (text/multimodal vision).
- **Category tabs & search**: Filter prompt cards by operational category (All, Concept Scan, Vine Crawl, Ingestion) combined with live keyword search across keys and template bodies.
- **Preview & safe reset**: Cyber confirmation modal with default prompt template preview before resetting to defaults (no browser native alert/confirm).
- **OS-level locale auto-detection**: Automatically detects system and browser default language (Traditional Chinese, English, Japanese) across Windows, macOS, and Linux on first launch, with localStorage persistence.
- **Universal component internationalization**: 100% complete multi-language support across all toolbar buttons, 3D controls, AST layers, relationship filters, and interactive dialogs.

### AI conversational knowledge retrieval — v3.0.0
- **Ask the knowledge base, not a vector store**: a floating chat panel answers questions through DocGraphical's own MCP tools — `docgraphical_search` for library-wide discovery, `docgraphical_toc` + `docgraphical_section` for surgical section reads, `docgraphical_graph` for structural context. Every answer is assembled from verbatim slices; no embeddings, no fuzzy semantic retrieval.
- **Bounded tool loop, streamed**: up to five tool rounds per turn, streamed to the browser over SSE (`POST /api/chat`) as typed events — `tool_call`, `tool_result`, `delta`, `citation`, `done`, `error`.
- **Grounded citations that jump**: every claim carries `[[file#heading]]`; the renderer turns each into a click target that opens the exact section in the viewer and locates it on the 3D map.
- **Context-aware and read-only**: the currently open document is carried as chat context; the tool loop can only read (search / TOC / slice / graph), never write to the library — the human gate stays intact.
- **App-wide LLM provider**: the chat reuses the same active provider as ingest and mining (OpenAI-compatible, key stored server-side); missing configuration surfaces as a clear in-chat error instead of a silent failure.

### Continuous integration & release automation — v3.0.0
- **CI gate**: `.github/workflows/ci.yml` lints both packages (`docgraph`, `docgraphical`), syntax-checks the frontend bundle, and runs `pytest` across Python 3.9–3.12 on Linux, Windows, and macOS.
- **Tag-driven releases**: `.github/workflows/release.yml` builds the sdist/wheel on every `v*` tag, extracts that version's section from `CHANGELOG.md` as the release body, and publishes the GitHub Release with the artifacts attached — no manual upload step.

---

## Target architecture

```text
DocGraphical Web (knowledge management UI)
[3D knowledge map] [TOC reading] [candidate-hit list] [AI chat panel] <- live (v3.0.0)
              ^ Dogma 4: human gate (chat about this section)
Dialogue backend = tool loop (live: search / toc / section / graph, read-only)
MCP knowledge layer (existing: toc / section / search / graph / index)
Deterministic foundation (existing: parser / scanner / db)
Raw originals (immutable raw layer: md / pdf / ppt / word)
```

---

## Roadmap (see PLAN §7)

| Phase | Content | Status |
|---|---|---|
| Phase 0 decisions | LLM endpoint (O1), hard-link semantics (O4), KB location (O5) | Pending |
| Phase 1 multi-format ingest (M5) | CPU extract → LLM summarize → store → rescan; web dialog landed | In progress |
| Phase 2 dialogue backend (M1) | `/api/chat` SSE + tool loop + human gate | Done (v3.0.0) |
| Phase 3 chat UI (M2+M3) | chat-about-this-section, candidate list, streaming panel, citation jumps | Done (v3.0.0) |
| Phase 4 slice-aggregation QA | Cross-doc search → aggregate → one read-through answer (dogma 3) | Not started |
| Phase 5 wiki cache layer (M4, stage 2) | Answer write-back + fingerprint invalidation + lint-lite | Stage 2 |

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

- **v3.0.1** — Knowledge Topology Compound Ingest (Pass-2 concept matching & candidate pills), Knowledge Library Linting & Governance (5-dimension health inspection & scoring), and image alt-text & attachment indexing penetration.
- **v3.0.0** — AI conversational knowledge retrieval live (MCP tool loop, SSE streaming, `[[file#heading]]` citations that jump to viewer + 3D), prompts manager with category tabs / preview / safe reset, OS locale auto-detection, CI + tag-driven releases.
- **v1.5.0** — concept layer live (Prospect + Vine, staged pool, human promote), crawler hardened (drain-livelock fix, token caps, hard deadlines, requeue), draft-review UX (preview banner, plain-words progress, page history).
- Web studio (port 5002 main DB / 5003 clean instance) + Electron desktop copy (`app/`, byte-synced).
- Open issues (O1–O5) and acceptance criteria: see [`PLAN.zh-TW.md`](PLAN.zh-TW.md) §7, §9.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.zh-TW.md](CONTRIBUTING.zh-TW.md) for code standards, test runs, and the PR process.

---

## License

DocGraphical is released under the [MIT License](LICENSE) for free personal and commercial use.
