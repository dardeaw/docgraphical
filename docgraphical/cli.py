"""DocGraphical Command Line Interface (CLI)."""

import argparse
import sys
from docgraph import __version__
from docgraphical.parser import extract_toc, extract_section, search_doc


def main():
    parser = argparse.ArgumentParser(
        prog="docgraph",
        description="DocGraphical: Precision Markdown AST, TOC & Section Slicer for AI Agents & Developers."
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
    subparsers.add_parser("mcp", help="Start DocGraphical Model Context Protocol (MCP) server")

    # Command: workspace
    ws_parser = subparsers.add_parser("workspace", help="Manage named documentation workspaces")
    ws_sub = ws_parser.add_subparsers(dest="ws_action", help="Workspace actions")
    ws_sub.add_parser("list", help="List all available workspaces")
    ws_switch = ws_sub.add_parser("switch", help="Switch active workspace")
    ws_switch.add_argument("id", help="Workspace ID to activate")
    ws_create = ws_sub.add_parser("create", help="Create a new workspace")
    ws_create.add_argument("name", help="Display name of the new workspace")
    ws_create.add_argument("--copy-from", help="Optional source workspace ID to copy roots from")
    ws_rename = ws_sub.add_parser("rename", help="Rename an existing workspace")
    ws_rename.add_argument("id", help="Target workspace ID")
    ws_rename.add_argument("new_name", help="New display name")
    ws_del = ws_sub.add_parser("delete", help="Delete a workspace")
    ws_del.add_argument("id", help="Workspace ID to delete")

    parser.add_argument("-w", "--workspace", help="Target workspace ID to operate within")

    args = parser.parse_args()

    if getattr(args, "workspace", None):
        import os
        os.environ["DOCGRAPHICAL_ACTIVE_WORKSPACE"] = args.workspace

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
        from docgraphical.mcp_server import run_mcp
        run_mcp()

    elif args.command == "workspace":
        from docgraphical import workspace
        action = getattr(args, "ws_action", "list") or "list"
        if action == "list":
            workspaces = workspace.list_workspaces()
            print(f"{'ID':<15} {'Name':<25} {'Repos':<8} {'Active'}")
            print("-" * 55)
            for w in workspaces:
                act = "*" if w.get("is_active") else ""
                print(f"{w['id']:<15} {w['name']:<25} {w['roots_count']:<8} {act}")
        elif action == "switch":
            res = workspace.switch_workspace(args.id)
            if res.get("success"):
                print(f"Switched active workspace to: {args.id}")
            else:
                print(f"Error: {res.get('error')}", file=sys.stderr)
                sys.exit(1)
        elif action == "create":
            res = workspace.create_workspace(args.name, copy_from=args.copy_from)
            if res.get("success"):
                ws_info = res["workspace"]
                print(f"Workspace created successfully: {ws_info['id']} ({ws_info['name']})")
            else:
                print(f"Error: {res.get('error')}", file=sys.stderr)
                sys.exit(1)
        elif action == "rename":
            res = workspace.rename_workspace(args.id, args.new_name)
            if res.get("success"):
                print(f"Workspace '{args.id}' renamed to: {args.new_name}")
            else:
                print(f"Error: {res.get('error')}", file=sys.stderr)
                sys.exit(1)
        elif action == "delete":
            res = workspace.delete_workspace(args.id)
            if res.get("success"):
                print(f"Workspace '{args.id}' deleted. Active workspace now: {res['active']}")
            else:
                print(f"Error: {res.get('error')}", file=sys.stderr)
                sys.exit(1)


if __name__ == "__main__":
    main()
