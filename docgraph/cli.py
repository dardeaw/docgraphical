"""DocGraph Command Line Interface (CLI)."""

import argparse
import sys
from docgraph import __version__
from docgraph.parser import extract_toc, extract_section, search_doc


def main():
    parser = argparse.ArgumentParser(
        prog="docgraph",
        description="DocGraph: Precision Markdown AST, TOC & Section Slicer for AI Agents & Developers."
    )
    parser.add_argument("-v", "--version", action="version", version=f"%(prog)s {__version__}")
    
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # Command: toc
    toc_parser = subparsers.add_parser("toc", help="Extract Table of Contents (TOC) with line numbers")
    toc_parser.add_argument("file", help="Path to the Markdown file")
    toc_parser.add_argument("--json", action="store_true", help="Output TOC as JSON format")
    toc_parser.add_argument("--md", action="store_true", help="Output TOC as Markdown list")

    # Command: section
    sec_parser = subparsers.add_parser("section", help="Extract a specific section by heading")
    sec_parser.add_argument("file", help="Path to the Markdown file")
    sec_parser.add_argument("heading", help="Target heading title (e.g. 'Installation' or '## API')")
    sec_parser.add_argument("--no-sub", action="store_true", help="Exclude subsections under this heading")

    # Command: search
    search_parser = subparsers.add_parser("search", help="Search keywords across Markdown file or folder")
    search_parser.add_argument("path", help="Path to Markdown file or root directory")
    search_parser.add_argument("query", help="Search keyword or term")
    search_parser.add_argument("--limit", type=int, default=30, help="Maximum number of search results")

    # Command: mcp
    mcp_parser = subparsers.add_parser("mcp", help="Start DocGraph Model Context Protocol (MCP) server")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    if args.command == "toc":
        fmt = "json" if args.json else ("markdown" if args.md else "text")
        print(extract_toc(args.file, format_type=fmt))

    elif args.command == "section":
        print(extract_section(args.file, args.heading, include_subsections=not args.no_sub))

    elif args.command == "search":
        print(search_doc(args.path, args.query, max_results=args.limit))

    elif args.command == "mcp":
        from docgraph.mcp_server import run_mcp
        run_mcp()


if __name__ == "__main__":
    main()
