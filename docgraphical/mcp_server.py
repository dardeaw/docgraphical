"""DocGraphical Native Model Context Protocol (MCP) Server.
Full integration with SQLite Graph Topology (.docgraphical/docgraphical.db), TOC Slicing, and AST Indexing.
"""

from __future__ import annotations

import json
import sys
from docgraphical.parser import extract_toc, extract_section, search_doc
from docgraphical.db import index_repository, fetch_graph_data, get_db_path


def tool_toc(filePath: str, format: str = "text") -> str:
    """Extract Table of Contents (TOC) with line anchors from a Markdown file to save 97% context tokens."""
    return extract_toc(filePath, format_type=format)


def tool_section(filePath: str, heading: str, includeSubsections: bool = True) -> str:
    """Surgically extract the content of a specific heading section without reading the whole file."""
    return extract_section(filePath, heading, include_subsections=includeSubsections)


def tool_search(filePath: str = "", query: str = "", limit: int = 30) -> str:
    """Search across Markdown documents or folders and locate exact line numbers and matches."""
    return search_doc(filePath, query, max_results=limit)


def tool_graph(repoPath: str) -> str:
    """Retrieve 3D knowledge topology graph (nodes, edges, cross-document links) from .docgraphical/docgraphical.db."""
    try:
        data = fetch_graph_data(repoPath)
        return json.dumps({
            "nodes_count": len(data["nodes"]),
            "links_count": len(data["links"]),
            "nodes": data["nodes"][:50],  # summary sample
            "sample_links": data["links"][:50]
        }, indent=2, ensure_ascii=False)
    except Exception as e:
        return f"Error fetching graph: {e}"


def tool_index(repoPath: str) -> str:
    """Scan and build/refresh .docgraphical/docgraphical.db SQLite AST graph index for a project."""
    try:
        res = index_repository(repoPath, incremental=True)
        return (f"Successfully indexed {repoPath}: {res['files']} files "
                f"({res['parsed']} parsed, {res['skipped']} unchanged, "
                f"{res['removed']} removed), {res['nodes']} nodes, "
                f"{res['edges']} edges stored in .docgraphical/docgraphical.db")
    except Exception as e:
        return f"Error indexing repository: {e}"


# Standard MCP Tool Definitions (JSON Schema for LLM Function Calling & MCP dispatch)
MCP_TOOLS_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "docgraphical_search",
            "description": "Search across Markdown documents, knowledge base, or folders to locate exact matches and line numbers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filePath": {
                        "type": "string",
                        "description": "File or folder path to search in. Leave empty or pass '' to search globally across the entire knowledge base."
                    },
                    "query": {
                        "type": "string",
                        "description": "Keywords, concepts, or terms to search for (e.g. 'CVX 產線', '產品')."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of matched sections to return (default: 20)."
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "docgraphical_toc",
            "description": "Extract Table of Contents (TOC) outline with line anchors from a Markdown file without loading whole file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filePath": {
                        "type": "string",
                        "description": "Path to the Markdown file."
                    },
                    "format": {
                        "type": "string",
                        "enum": ["text", "json"],
                        "description": "Output format: 'text' or 'json' (default: text)."
                    }
                },
                "required": ["filePath"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "docgraphical_section",
            "description": "Surgically extract the exact verbatim Markdown content of a specific heading section without reading the whole file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filePath": {
                        "type": "string",
                        "description": "Path to the Markdown file containing the section."
                    },
                    "heading": {
                        "type": "string",
                        "description": "Exact heading title to extract (matches H1-H6)."
                    },
                    "includeSubsections": {
                        "type": "boolean",
                        "description": "Whether to include subheadings underneath this section (default: true)."
                    }
                },
                "required": ["filePath", "heading"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "docgraphical_graph",
            "description": "Retrieve 3D knowledge topology graph (nodes, edges, cross-document links) from local SQLite database.",
            "parameters": {
                "type": "object",
                "properties": {
                    "repoPath": {
                        "type": "string",
                        "description": "Path to the repository."
                    }
                },
                "required": ["repoPath"]
            }
        }
    }
]

MCP_TOOL_HANDLERS = {
    "docgraphical_search": tool_search,
    "docgraphical_toc": tool_toc,
    "docgraphical_section": tool_section,
    "docgraphical_graph": tool_graph,
    "docgraphical_index": tool_index,
}


def execute_mcp_tool(tool_name: str, arguments: dict) -> str:
    """Standard MCP tool dispatcher: executes an MCP tool by name and arguments."""
    handler = MCP_TOOL_HANDLERS.get(tool_name)
    if not handler:
        return f"Error: Unknown MCP tool '{tool_name}'"
    try:
        # Normalize arg keys (e.g. camelCase or snake_case)
        return handler(**arguments)
    except TypeError as e:
        return f"Error executing '{tool_name}' with arguments {arguments}: {e}"
    except Exception as e:
        return f"Execution error in '{tool_name}': {type(e).__name__}: {e}"


def run_mcp():
    """Start MCP Server using official MCP SDK (stdio transport)."""
    try:
        from mcp.server import MCPServer
    except ImportError:
        print(
            "Error: 'mcp' SDK is required to run the MCP server.\n"
            "Install it via: pip install mcp",
            file=sys.stderr
        )
        sys.exit(1)

    app = MCPServer("docgraph")

    app.tool()(tool_toc)
    app.tool()(tool_section)
    app.tool()(tool_search)
    app.tool()(tool_graph)
    app.tool()(tool_index)

    app.run(transport="stdio")


if __name__ == "__main__":
    run_mcp()
