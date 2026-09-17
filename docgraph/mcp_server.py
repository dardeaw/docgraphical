"""DocGraph Native Model Context Protocol (MCP) Server.
Full integration with SQLite Graph Topology (.docgraph/docgraph.db), TOC Slicing, and AST Indexing.
"""

from __future__ import annotations

import json
import os
import sys
from docgraph.parser import extract_toc, extract_section, search_doc
from docgraph.db import index_repository, fetch_graph_data, get_db_path


def run_mcp():
    """Start MCP Server using official MCP SDK."""
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

    @app.tool()
    def docgraph_toc(filePath: str, format: str = "text") -> str:
        """Extract Table of Contents (TOC) with line anchors from a Markdown file to save 97% context tokens."""
        return extract_toc(filePath, format_type=format)

    @app.tool()
    def docgraph_section(filePath: str, heading: str, includeSubsections: bool = True) -> str:
        """Surgically extract the content of a specific heading section without reading the whole file."""
        return extract_section(filePath, heading, include_subsections=includeSubsections)

    @app.tool()
    def docgraph_search(filePath: str, query: str, limit: int = 30) -> str:
        """Search across Markdown documents or folders and locate exact line numbers and matches."""
        return search_doc(filePath, query, max_results=limit)

    @app.tool()
    def docgraph_graph(repoPath: str) -> str:
        """Retrieve 3D knowledge topology graph (nodes, edges, cross-document links) from .docgraph/docgraph.db."""
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

    @app.tool()
    def docgraph_index(repoPath: str) -> str:
        """Scan and build/refresh .docgraph/docgraph.db SQLite AST graph index for a project."""
        try:
            f, n, e = index_repository(repoPath)
            return f"Successfully indexed {repoPath}: {f} files, {n} nodes, {e} edges stored in .docgraph/docgraph.db"
        except Exception as e:
            return f"Error indexing repository: {e}"

    app.run(transport="stdio")


if __name__ == "__main__":
    run_mcp()
