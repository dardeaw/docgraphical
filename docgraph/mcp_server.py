"""DocGraph Native Model Context Protocol (MCP) Server."""

import sys
from docgraph.parser import extract_toc, extract_section, search_doc


def run_mcp():
    """Start MCP Server using standard MCP SDK."""
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
        """Extract Table of Contents (TOC) with line anchors from a Markdown file to save tokens."""
        return extract_toc(filePath, format_type=format)

    @app.tool()
    def docgraph_section(filePath: str, heading: str, includeSubsections: bool = True) -> str:
        """Surgically extract the full content of a specific heading section without reading the whole file."""
        return extract_section(filePath, heading, include_subsections=includeSubsections)

    @app.tool()
    def docgraph_search(filePath: str, query: str, limit: int = 30) -> str:
        """Search across Markdown documents and locate exact line numbers and matches."""
        return search_doc(filePath, query, max_results=limit)

    app.run(transport="stdio")


if __name__ == "__main__":
    run_mcp()
