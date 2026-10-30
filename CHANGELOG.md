# Changelog

[English](CHANGELOG.md) | [繁體中文](CHANGELOG.zh-TW.md)

All notable changes to the DocGraphical project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.1] - 2026-10-30

### Added
- **Omni-Channel Ingest**: One-click Web Crawling that strips ads/scripts and formats clean Markdown notes; Hybrid Multimodal Summarization combining text/clipboard documents with diagrams and screenshots, embedding relative image links directly into summaries.
- **Knowledge Topology Compound Ingest**: Secondary pass during document ingestion that extracts matching concepts and mines candidate terms for human review via interactive pills.
- **Knowledge Library Linting & Governance**: Dedicated governance drawer providing a comprehensive 5-dimension health audit (orphans, broken links, circular references, empty sections, unindexed concepts) and 0–100 score with one-click navigation.
- **Image & Attachment Alt-Text Indexing**: Full-text `search_doc` penetrates `![Alt](Path)` image tags and filenames; the MCP chat loop automatically inspects active document attachments.

### Changed
- Refined 3D graph concept capsule border width (0.2 fine line) for enhanced visual clarity.
- Updated Explorer tree body and prompt manager cards to a sleek slate white-gray (`#262c36`).
- Hardened Vine Crawling to strictly enforce human-review gates and prevent background auto-commit.

---

## [3.0.0] - 2026-10-26

### Added
- **AI conversational knowledge retrieval**: floating chat panel answering through DocGraphical's own MCP tools (`docgraphical_search`, `docgraphical_toc`, `docgraphical_section`, `docgraphical_graph`) — every answer assembled from verbatim slices, no embeddings.
- **Streaming tool loop**: `POST /api/chat` emits SSE events (`tool_call`, `tool_result`, `delta`, `citation`, `done`, `error`), bounded to five tool rounds per turn.
- **Grounded citations**: `[[file#heading]]` anchors in answers become click targets that open the exact section in the viewer and locate it on the 3D map.
- **Context-aware, read-only retrieval**: the open document travels with the conversation; tools can only read, never write to the library.
- **Prompt manager**: drawer panel for all six LLM prompts (concept scan, vine seed/file/finish, ingest text/vision) with category tabs, live search, default-template preview, and safe reset; custom prompts persist in `~/.docgraphical/prompts.json`.
- **OS locale auto-detection**: Traditional Chinese / English / Japanese detected from the system on first launch, persisted in localStorage.
- **CI and tag-driven releases**: `.github/workflows/ci.yml` gates lint + `pytest` + frontend syntax checks; `.github/workflows/release.yml` builds the distribution and publishes the GitHub Release with notes extracted from this file.

### Changed
- All version strings (`package.json`, `pyproject.toml`, both `__init__.py`, frontend asset tag) unified on the 3.x line.
- README (EN / zh-TW) now documents the AI conversation panel, the prompt manager, and the release pipeline; roadmap phases 2 and 3 marked done.

### Fixed
- Directory browse dialog hang on disconnected Windows network drives (logical drive bitmask enumeration instead of the slow drive-type query).
- Non-destructive repository exclusion from the monitoring list.

## [1.7.0] - 2026-10-26

### Added
- Prompts Manager drawer with customizable runtime prompt templates for concept scan, vine crawl (seed, file inspection, finish review), and ingestion (text, vision).
- Categorized prompt tabs (All, Concept Scan, Vine Crawl, Ingestion) and live keyword search across prompt keys and prompt text.
- Cyber confirmation modal with default prompt preview on reset (eliminates browser native alert/confirm popups).
- Cross-platform OS and browser locale auto-detection on first visit with localStorage preference persistence.
- Complete universal multi-language support (English, Traditional Chinese, Japanese) for all toolbar buttons, 3D controls, AST layers, relationship links, and action modals.

### Fixed
- Fixed directory browse dialog hang on disconnected Windows network drives (replaced slow drive type query with pure logical drive bitmask enumeration).
- Fixed non-destructive repository exclusion from monitoring list.

## [1.6.9] - 2026-10-26

### Changed
- Aligned every version string (`package.json`, `pyproject.toml`, both `__init__.py`, frontend asset tag) from the stale 1.0.0 to the release line; backfilled CHANGELOG coverage (EN/zh-TW) for v1.3.0–v1.6.8.

## [1.6.8] - 2026-10-26

### Fixed
- Drill-down display is now selection-scoped and temporary: selecting a hidden node reveals only its upward ancestor chain (node → … → H1 → file) through a per-node id set, never touching `hiddenKinds` / legend.
- First click on a hidden heading after refresh now shows its ball immediately: chain nodes never laid out before are seeded at their ancestor's coordinates, so the camera centers on the node itself — no second click needed.
- Clicking back up (e.g. H3 → H2) automatically re-hides the lower kinds; the 3D only gains that chain's nodes instead of a 42/81-ball flood.

## [1.6.7] - 2026-10-26

### Fixed
- The revealed 3D label no longer lags one selection behind: the label pass now refreshes at `focusOnNode`, the single writer of `activeNode`.
- New single source of truth (`resolveRevealedNodeId` + `labelStyleFor`) shared by the refresh pass and lazily-created label sprites, so a plate is born with the correct color and opacity.

## [1.6.6] - 2026-10-22

### Changed
- Selecting an LOD-hidden node temporarily unhides its kind so the node itself appears in 3D and the highlight path runs visibly from the selected node up to its ancestors (later refined by 1.6.8 into a selection-scoped id set).

## [1.6.5] - 2026-10-22

### Fixed
- The camera for a hidden selected node centers on the nearest visible ancestor instead of flying to empty space on stale coordinates or staying put.

## [1.6.4] - 2026-10-21

### Fixed
- The Discover Concepts dialog scope panel is now a one-way reference of the Explorer selection: read-only checkboxes; the dialog never writes back to the outer graph or selection.

## [1.6.3] - 2026-10-21

### Added
- Scope-panel checkboxes two-way synced with the Explorer selection; Prospect scan sends the checked repos (multi-repo supported) while Vine takes the first checked repo.

## [1.6.2] - 2026-10-21

### Added
- The Discover Concepts dialog gains a left "scan scope" panel (920px two-column layout): a 300px repository/.md scope column with an active-repo marker.

## [1.6.1] - 2026-10-21

### Fixed
- `ja` locale defined in four i18n scopes so the candidate tab, unlink action, scan dialog and concept modal stop throwing.

## [1.6.0] - 2026-10-20

### Added
- Full Japanese UI plus plain-language release copy.

### Fixed
- Two crash fixes, including a white-screen startup failure.

## [1.5.0] - 2026-10-18

### Added
- Concept layer live: concept tags, spotlight, wiki-link edges and draft-review UX (staged runs/items, scan evidence).

### Fixed
- Crawler hardening.

## [1.4.0] - 2026-10-08

### Added
- Batch ingest formats: txt / md / csv / html / eml plus direct-to-vision images.
- Concept-layer foundations, batch ingest pipeline and workstation UX improvements.

## [1.3.0] - 2026-10-06

### Added
- Repositioned as a KM-oriented knowledge management platform.

## [1.0.0] - 2026-09-18

### Added
- **Deterministic AST Parser**: Line-by-line state machine parser with strict fenced code block protection.
- **Surgical Section Slicer**: Extracts exact heading content and child subtrees while saving ~97.4% tokens.
- **TOC Outline Extractor**: Rapid outline generation with line anchors in text and JSON formats.
- **Dual Runtime Support**: Full feature parity across Python 3.9+ and Node.js 18+ runtimes.
- **Model Context Protocol (MCP) Server**: Native stdio JSON-RPC 2.0 server supporting `docgraphical_toc`, `docgraphical_section`, `docgraphical_search`, `docgraphical_graph`, and `docgraphical_index`.
- **3D Visual AST Studio**: WebGL force-directed graph with slot-based stage swap, immediate ancestor centering, dynamic SpriteText shrine reveal, and subtle translucent galactic depth.
- **Desktop Studio Application**: Electron wrapper with cross-platform desktop build configurations.
- **Comprehensive Documentation Suite**: Dignified, formal bilingual documentation in English and Traditional Chinese.
