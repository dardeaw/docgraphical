#!/usr/bin/env python
"""DocGraphical - Precision Markdown AST & Section Slicer Server Entrypoint."""
import sys
import argparse
from docgraphical.server import create_app
from docgraphical.constants import DEFAULT_HOST, DEFAULT_PORT

def main():
    parser = argparse.ArgumentParser(description="DocGraphical - Precision Markdown Intelligence Server")
    parser.add_argument("-p", "--port", type=int, default=DEFAULT_PORT, help="Port to bind server (default: 5002)")
    parser.add_argument("-H", "--host", default=DEFAULT_HOST, help="Host to bind server (default: 127.0.0.1)")
    parser.add_argument("paths", nargs="*", help="Optional project directory roots to scan")

    args = parser.parse_args()
    app = create_app(initial_paths=args.paths)
    print(f"===============================================================")
    print(f"   📄 DocGraphical Server Running on http://{args.host}:{args.port}")
    print(f"   Precision Markdown AST, TOC & Section Intelligence Suite")
    print(f"===============================================================")
    app.run(host=args.host, port=args.port, debug=False)

if __name__ == "__main__":
    main()
