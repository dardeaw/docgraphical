# 📄 DocGraph

> **The Surgical Precision Markdown AST & Section Slicer for AI Coding Agents.**  
> *Save up to 97% Context Tokens when inspecting long PRDs, specs, and design documents.*

[![CI](https://github.com/dardeaw/docgraph/actions/workflows/ci.yml/badge.svg)](https://github.com/dardeaw/docgraph/actions)
[![Python Version](https://img.shields.io/badge/python-3.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-blue)](https://pypi.org/project/docgraph/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP Protocol](https://img.shields.io/badge/MCP-Native%20Support-purple.svg)](https://modelcontextprotocol.io/)

---

## ⚡ Why DocGraph?

When AI Coding Agents (such as Claude Code, Cursor, Windsurf, or Antigravity) are instructed to read a 1,500-line requirement specification (`.md`), standard tools dump the entire file into the context window:
- 💸 **Token Exhaustion**: Costs 10k ~ 30k context tokens per view.
- 😵 **Context Dilution (Lost in the Middle)**: Floods the LLM's attention with irrelevant chapters, causing hallucinations.
- 📉 **Broken RAG Chunking**: Traditional vector search blindly cuts across code fences and heading hierarchies.

**DocGraph solves this with surgical precision:**
1. **Extract TOC First (~30 tokens)**: Get the full heading structure and line number anchors.
2. **Slice Exact Section (~100 tokens)**: Retrieve only the specific chapter your agent needs, code blocks intact.

---

## 🚀 Installation

```bash
# Direct install via pip
pip install docgraph

# Or with native MCP server support
pip install "docgraph[mcp]"
```

---

## 💻 CLI Usage

### 1. Extract Table of Contents (TOC)
```bash
docgraph toc docs/architecture.md
```
Output:
```text
=== [DocGraph TOC] architecture.md ===
[Line    1] # System Overview
[Line   24]   ## 1. Storage Engine
[Line   58]     ### 1.1 WAL Protocol
[Line  112]     ### 1.2 LSM-Tree Compaction
[Line  180]   ## 2. Network Protocol
```

### 2. Surgically Slice a Target Section
```bash
docgraph section docs/architecture.md "1. Storage Engine"
```
*Outputs only chapter 1 and its sub-sections, stopping cleanly at chapter 2!*

### 3. Search Keywords with Line Numbers
```bash
docgraph search docs/ "compaction"
```

---

## 🤖 MCP Server Setup (for Cursor / Claude Desktop / Antigravity)

Add DocGraph to your MCP configuration (`mcp_config.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "docgraph": {
      "command": "docgraph",
      "args": ["mcp"]
    }
  }
}
```

### Available MCP Tools:
- `docgraph_toc(filePath)`: Returns hierarchical table of contents with line numbers.
- `docgraph_section(filePath, heading, includeSubsections)`: Surgically extracts section content.
- `docgraph_search(filePath, query, limit)`: Fast keyword search across documentation.

---

## 🧪 Testing

```bash
pytest
```

---

## 📄 License
MIT License © 2026 Chunghsing Tech / CodeGraph Team
