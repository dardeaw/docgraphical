"""Flask web server application factory and RESTful API routing for DocGraph."""
import os
from typing import Optional, List
from flask import Flask, jsonify, request, Response, render_template
from .config import load_config, save_config, get_search_roots
from .scanner import scan_doc_repositories, get_dir_file_tree, get_repo_doc_metrics
from .parser import extract_toc, extract_section, search_doc, parse_headings
from .db import index_repository, fetch_graph_data, get_db_path

def create_app(initial_paths: Optional[List[str]] = None, search_roots: Optional[List[str]] = None) -> Flask:
    """Create and configure the DocGraph Flask application."""
    if initial_paths and not search_roots:
        search_roots = initial_paths

    app_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    template_dir = os.path.join(app_root, "templates")
    static_dir = os.path.join(app_root, "static")

    app = Flask(
        "docgraph",
        template_folder=template_dir,
        static_folder=static_dir
    )

    @app.after_request
    def add_security_and_cache_headers(response: Response) -> Response:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/projects", methods=["GET"])
    def get_projects():
        roots = get_search_roots(search_roots)
        repos = scan_doc_repositories(roots)
        result = []
        for name, p in repos.items():
            metrics = get_repo_doc_metrics(p)
            db_file = os.path.join(p, ".docgraph", "docgraph.db")
            has_db = os.path.exists(db_file)
            result.append({
                "name": name,
                "path": p,
                "files": metrics["files"],
                "headings": metrics["headings"],
                "size": metrics["size"],
                "has_db": has_db,
                "status": "ready" if metrics["files"] > 0 else "empty"
            })
        return jsonify(result)

    @app.route("/api/graph", methods=["GET"])
    def get_graph():
        target_path = request.args.get("path", "").strip()
        if not target_path or not os.path.exists(target_path):
            roots = get_search_roots(search_roots)
            target_path = roots[0] if roots else os.getcwd()
        
        data = fetch_graph_data(target_path)
        return jsonify(data)

    @app.route("/api/index", methods=["POST"])
    def trigger_index():
        data = request.get_json(silent=True) or {}
        target_path = data.get("path", "").strip()
        if not target_path or not os.path.exists(target_path):
            return jsonify({"success": False, "error": "Invalid project path"}), 400
        
        f_cnt, n_cnt, e_cnt = index_repository(target_path)
        return jsonify({"success": True, "files": f_cnt, "nodes": n_cnt, "edges": e_cnt})

    @app.route("/api/tree", methods=["GET"])
    def get_tree():
        target_path = request.args.get("path", "").strip()
        if not target_path or not os.path.exists(target_path):
            roots = get_search_roots(search_roots)
            target_path = roots[0] if roots else os.getcwd()
        tree = get_dir_file_tree(target_path)
        return jsonify(tree)

    @app.route("/api/doc/toc", methods=["GET"])
    def get_doc_toc():
        file_path = request.args.get("file", "").strip()
        format_type = request.args.get("format", "json").strip()
        if not file_path or not os.path.isfile(file_path):
            return jsonify({"error": "File not found"}), 404
        toc_output = extract_toc(file_path, format_type=format_type)
        if format_type == "json":
            import json
            try:
                return jsonify(json.loads(toc_output))
            except Exception:
                return jsonify([])
        return Response(toc_output, mimetype="text/plain")

    @app.route("/api/doc/section", methods=["GET"])
    def get_doc_section():
        file_path = request.args.get("file", "").strip()
        heading = request.args.get("heading", "").strip()
        include_sub = request.args.get("sub", "1") == "1"
        if not file_path or not os.path.isfile(file_path):
            return jsonify({"error": "File not found"}), 404
        if not heading:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return jsonify({"heading": "Full Document", "content": content, "sliced": False})
        
        sec = extract_section(file_path, heading, include_subsections=include_sub)
        return jsonify({"heading": heading, "content": sec, "sliced": True})

    @app.route("/api/doc/search", methods=["GET"])
    def search_documents():
        target_path = request.args.get("path", "").strip()
        query = request.args.get("q", "").strip()
        limit = int(request.args.get("limit", 30))
        if not target_path or not os.path.exists(target_path):
            roots = get_search_roots(search_roots)
            target_path = roots[0] if roots else os.getcwd()
        if not query:
            return jsonify({"results": []})
        
        output = search_doc(target_path, query, max_results=limit)
        return jsonify({"query": query, "output": output})

    @app.route("/api/paths/add", methods=["POST"])
    def add_custom_path():
        data = request.get_json(silent=True) or {}
        new_path = data.get("path", "").strip()
        if not new_path or not os.path.exists(new_path):
            return jsonify({"success": False, "error": "Invalid or nonexistent directory path"}), 400
        
        abs_p = os.path.abspath(new_path)
        cfg = load_config()
        if abs_p not in cfg["custom_roots"]:
            cfg["custom_roots"].append(abs_p)
            if abs_p in cfg["excluded_paths"]:
                cfg["excluded_paths"].remove(abs_p)
            save_config(cfg)
        return jsonify({"success": True, "path": abs_p})

    @app.route("/api/paths/exclude", methods=["POST"])
    def exclude_custom_path():
        data = request.get_json(silent=True) or {}
        target_path = data.get("path", "").strip()
        if not target_path:
            return jsonify({"success": False, "error": "Missing path parameter"}), 400
        
        abs_p = os.path.abspath(target_path)
        cfg = load_config()
        if abs_p in cfg["custom_roots"]:
            cfg["custom_roots"].remove(abs_p)
        if abs_p not in cfg["excluded_paths"]:
            cfg["excluded_paths"].append(abs_p)
        save_config(cfg)
        return jsonify({"success": True, "path": abs_p})

    return app
