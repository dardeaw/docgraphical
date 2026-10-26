# Changelog

[English](CHANGELOG.md) | [繁體中文](CHANGELOG.zh-TW.md)

All notable changes to the DocGraphical project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
