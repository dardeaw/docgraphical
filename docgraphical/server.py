"""Flask web server application factory and RESTful API routing for DocGraphical."""
import os
import shutil
import tempfile
import time
import uuid
from typing import Optional, List
from flask import Flask, jsonify, request, Response, render_template, send_file
from .config import load_config, save_config, get_search_roots
from .scanner import scan_doc_repositories, get_dir_file_tree, get_repo_doc_metrics
from .parser import extract_toc, extract_section, search_doc, parse_headings
from .db import (
    index_repository, fetch_graph_data, fetch_graph_merged, fts_search,
    get_db_path, get_db_stats, get_indexed_file_set, uninit_repository,
)
from .llm_provider import (
    FnListProviders, FnAddProvider, FnDeleteProvider, FnTestProvider,
    FnListRemoteModels, FnGetActiveLLM, FnSetActiveLLM,
)
from .ingest import (
    ALLOWED_EXTS, IMAGE_EXTS, FnSanitizeFilename, FnIngestDirOk, FnFindOwningRepo,
    FnExtractText, FnChatSummarize, FnExtractImages, FnVisionSummarize,
    VISION_MAX_TOTAL, FnUniqueMdPath, FnBuildMd,
)


def create_app(initial_paths: Optional[List[str]] = None, search_roots: Optional[List[str]] = None) -> Flask:
    """Create and configure the DocGraphical Flask application."""
    if initial_paths and not search_roots:
        search_roots = initial_paths

    def resolve_file(file_path: str) -> Optional[str]:
        if not file_path:
            return None
        if os.path.isfile(file_path):
            return os.path.abspath(file_path)
        roots = get_search_roots(search_roots)
        for r in roots:
            cand = os.path.normpath(os.path.join(r, file_path))
            if os.path.isfile(cand):
                return cand
            for dirpath, _, filenames in os.walk(r):
                if ".git" in dirpath or "node_modules" in dirpath or ".docgraphical" in dirpath:
                    continue
                for fn in filenames:
                    full = os.path.join(dirpath, fn)
                    if fn == file_path or full.replace('\\', '/').endswith(file_path.replace('\\', '/')):
                        return full
        return None

    app_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    template_dir = os.path.join(app_root, "templates")
    static_dir = os.path.join(app_root, "static")

    app = Flask(
        "docgraph",
        template_folder=template_dir,
        static_folder=static_dir
    )
    app.config['TEMPLATES_AUTO_RELOAD'] = True

    @app.after_request
    def add_security_and_cache_headers(response: Response) -> Response:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/health", methods=["GET"])
    def api_health():
        """Lightweight liveness probe for the status bar (#lbl-health)."""
        return jsonify({"status": "ok"})

    @app.route("/api/projects", methods=["GET"])
    def get_projects():
        roots = get_search_roots(search_roots)
        repos = scan_doc_repositories(roots)
        result = []
        for name, p in repos.items():
            indexed_set = get_indexed_file_set(p)  # None => no DB yet
            metrics = get_repo_doc_metrics(p, indexed_set)
            stats = get_db_stats(p)
            has_db = stats["has_db"]
            result.append({
                "name": name,
                "path": p,
                "files": metrics["files"],
                "headings": metrics["headings"],
                "nodes": stats["nodes"],
                "links": stats["links"],
                "size": metrics["size"],
                "is_indexed": has_db,
                "has_db": has_db,
                "pending_files": metrics["pending_files"],
                "pending_count": metrics["pending_count"],
                "unindexed_files": metrics.get("unindexed_files", []),
                "unindexed_count": metrics.get("unindexed_count", 0),
                "all_dirs": metrics.get("all_dirs", []),
                "source_files": metrics.get("source_files", []),
                "source_count": metrics.get("source_count", 0),
                "md_sources": metrics.get("md_sources", {}),
                "status": "ready" if has_db else "unindexed"
            })
        return jsonify(result)

    @app.route("/api/graph", methods=["GET"])
    def get_graph():
        # Multi-repo merge: ?path=a&path=b (galaxy-style). Missing/invalid
        # entries are dropped; single path keeps the legacy fetch_graph_data.
        vPaths: List[str] = []
        for p in request.args.getlist("path"):
            p = (p or "").strip()
            if p and os.path.isdir(p):
                a = os.path.abspath(p)
                if a not in vPaths:
                    vPaths.append(a)
        if not vPaths:
            roots = get_search_roots(search_roots)
            if roots and os.path.isdir(roots[0]):
                vPaths = [os.path.abspath(roots[0])]
            else:
                vPaths = [os.path.abspath(os.getcwd())]

        data = fetch_graph_merged(vPaths) if len(vPaths) > 1 else fetch_graph_data(vPaths[0])
        return jsonify(data)

    @app.route("/api/index", methods=["POST"])
    def trigger_index():
        data = request.get_json(silent=True) or {}
        target_path = data.get("path", "").strip()
        if not target_path or not os.path.exists(target_path):
            return jsonify({"success": False, "error": "Invalid project path"}), 400

        res = index_repository(target_path)
        return jsonify({"success": True, **res})

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
        real_path = resolve_file(file_path)
        if not real_path:
            return jsonify({"error": "File not found: " + file_path}), 404
        file_path = real_path
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
        real_path = resolve_file(file_path)
        if not real_path:
            return jsonify({"error": "File not found: " + file_path}), 404
        file_path = real_path
        if not heading:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return jsonify({"heading": "Full Document", "content": content,
                            "sliced": False, "full_chars": len(content)})

        sec = extract_section(file_path, heading, include_subsections=include_sub)
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                full_chars = len(f.read())
        except OSError:
            full_chars = len(sec)
        return jsonify({"heading": heading, "content": sec, "sliced": True,
                        "full_chars": full_chars})

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

    @app.route("/api/search", methods=["GET"])
    def search_nodes():
        """FTS5 full-text search across one or more indexed repos (dropdown).

        ?q=...&path=a&path=b  ->  {results: [{name,file,kind,level,line,path}]}
        Falls back to all search roots when no path is supplied.
        """
        strQ = request.args.get("q", "").strip()
        vPaths: List[str] = []
        for p in request.args.getlist("path"):
            p = (p or "").strip()
            if p and os.path.isdir(p):
                a = os.path.abspath(p)
                if a not in vPaths:
                    vPaths.append(a)
        if not vPaths:
            roots = get_search_roots(search_roots)
            vPaths = [os.path.abspath(r) for r in roots
                      if r and os.path.isdir(r)]
        if not strQ or not vPaths:
            return jsonify({"query": strQ, "results": []})
        try:
            limit = max(1, min(int(request.args.get("limit", 20)), 50))
        except (TypeError, ValueError):
            limit = 20
        return jsonify({"query": strQ, "results": fts_search(vPaths, strQ, limit)})

    @app.route("/api/browse", methods=["GET"])
    def browse_dirs():
        """Server-side directory picker for the web UI (no hand-typed paths).

        ?path=<abs dir> -> {current, parent, drives, dirs:[{name,path,has_docs}]}
        Empty path -> drive list (Windows) or filesystem root.
        has_docs = this dir directly contains doc files (worth adding).
        """
        from .scanner import is_doc_file
        req = (request.args.get("path") or "").strip()
        if req and os.path.isdir(req):
            cur = os.path.abspath(req)
        else:
            cur = ""
        if not cur:
            drives = []
            if os.name == "nt":
                import string
                for ch in string.ascii_uppercase:
                    d = ch + ":\\"
                    if os.path.isdir(d):
                        drives.append(d)
            else:
                drives.append("/")
            home = os.path.expanduser("~")
            return jsonify({"current": "", "parent": "",
                            "drives": drives,
                            "home": home if os.path.isdir(home) else "",
                            "dirs": []})
        dirs = []
        try:
            with os.scandir(cur) as it:
                for e in it:
                    try:
                        if not e.is_dir(follow_symlinks=False):
                            continue
                    except Exception:
                        continue
                    name = e.name
                    if name.startswith("$") or name == "System Volume Information":
                        continue
                    p = os.path.abspath(e.path)
                    has_docs = False
                    try:
                        with os.scandir(p) as it2:
                            for e2 in it2:
                                try:
                                    if e2.is_file(follow_symlinks=False) and is_doc_file(e2.name):
                                        has_docs = True
                                        break
                                except Exception:
                                    continue
                    except Exception:
                        pass
                    dirs.append({"name": name, "path": p, "has_docs": has_docs})
        except Exception as ex:
            return jsonify({"current": cur, "parent": os.path.dirname(cur),
                            "drives": [], "home": "", "dirs": [],
                            "error": str(ex)})
        dirs.sort(key=lambda d: (not d["has_docs"], d["name"].lower()))
        return jsonify({"current": cur, "parent": os.path.dirname(cur) or cur,
                        "drives": [], "home": "", "dirs": dirs})

    @app.route("/api/browse/mkdir", methods=["POST"])
    def browse_mkdir():
        """Create a new folder from the directory picker (New Folder button).

        Only inside an existing directory; name is sanitized (single segment,
        no separators/traversal). Returns the created absolute path.
        """
        data = request.get_json(silent=True) or {}
        parent = (data.get("parent") or "").strip()
        name = (data.get("name") or "").strip()
        if not parent or not os.path.isdir(parent):
            return jsonify({"success": False,
                            "error": "Parent directory does not exist"}), 400
        # Single path segment only: reject separators / traversal / blanks.
        bad = set('<>:"/\\|?*') | {chr(c) for c in range(32)}
        if (not name or name in (".", "..") or
                any(ch in name for ch in bad) or
                len(name) > 120):
            return jsonify({"success": False,
                            "error": "Invalid folder name"}), 400
        target = os.path.abspath(os.path.join(parent, name))
        # Ensure the result really stays under parent.
        if os.path.dirname(target) != os.path.abspath(parent):
            return jsonify({"success": False,
                            "error": "Invalid folder name"}), 400
        if os.path.exists(target):
            return jsonify({"success": False,
                            "error": "Folder already exists"}), 409
        try:
            os.makedirs(target)
        except Exception as ex:
            return jsonify({"success": False, "error": str(ex)}), 500
        return jsonify({"success": True, "path": target, "name": name})

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


    @app.route("/api/sync", methods=["POST"])
    def sync_project():
        data = request.get_json(silent=True) or {}
        target_path = data.get("path", "").strip()
        if not target_path or not os.path.exists(target_path):
            return jsonify({"success": False, "error": "Invalid project path"}), 400
        res = index_repository(target_path, incremental=True)
        return jsonify({"success": True, **res})

    @app.route("/api/reindex", methods=["POST"])
    def reindex_project():
        data = request.get_json(silent=True) or {}
        target_path = data.get("path", "").strip()
        if not target_path or not os.path.exists(target_path):
            return jsonify({"success": False, "error": "Invalid project path"}), 400
        # Delete old DB then rebuild fresh
        uninit_repository(target_path)
        res = index_repository(target_path)
        return jsonify({"success": True, **res})

    @app.route("/api/uninit", methods=["POST"])
    def uninit_project():
        data = request.get_json(silent=True) or {}
        target_path = data.get("path", "").strip()
        if not target_path or not os.path.exists(target_path):
            return jsonify({"success": False, "error": "Invalid project path"}), 400
        success = uninit_repository(target_path)
        return jsonify({"success": True, "uninitialized": success})

    @app.route("/api/sync_all", methods=["POST"])
    def sync_all_projects():
        """Incremental sync every indexed repo (global one-click Sync all)."""
        roots = get_search_roots(search_roots)
        repos = scan_doc_repositories(roots)
        results = {}
        totals = {"parsed": 0, "skipped": 0, "removed": 0, "nodes": 0, "edges": 0}
        synced = 0
        for name, p in repos.items():
            if get_indexed_file_set(p) is None:
                continue
            try:
                res = index_repository(p, incremental=True)
                results[name] = {"success": True, **res}
                synced += 1
                for k in totals:
                    totals[k] += res.get(k, 0) or 0
            except Exception as e:
                results[name] = {"success": False, "error": str(e)}
        return jsonify({"success": True, "synced": synced,
                        "totals": totals, "results": results})

    # ---------------- document ingest (pptx/docx/pdf -> LLM summary -> md) ----
    # Rule: the md lands NEXT TO the uploaded files and ALWAYS records each
    # source's repo-relative path in its header (server-prepended, not LLM).
    # Staging: picked files wait OUTSIDE the repo until the human confirms;
    # /save moves them into target_dir together with the md. Abandoned stages
    # older than a day are swept on the next staged upload.
    _STAGE_ROOT = os.path.join(tempfile.gettempdir(), "opencode", "dg_ingest_stage")

    def _FnSweepStages() -> None:
        try:
            if not os.path.isdir(_STAGE_ROOT):
                return
            now = time.time()
            for _name in os.listdir(_STAGE_ROOT):
                _p = os.path.join(_STAGE_ROOT, _name)
                try:
                    if now - os.path.getmtime(_p) > 86400:
                        shutil.rmtree(_p, ignore_errors=True)
                except OSError:
                    pass
        except OSError:
            pass

    def _FnMoveStagedIntoTarget(staged_abs: str, tgt: str) -> str:
        base = os.path.basename(staged_abs)
        stem, ext = os.path.splitext(base)
        dst = os.path.join(tgt, base)
        i = 1
        while os.path.exists(dst):
            i += 1
            dst = os.path.join(tgt, "%s-%d%s" % (stem, i, ext))
        shutil.move(staged_abs, dst)
        try:
            os.rmdir(os.path.dirname(staged_abs))
        except OSError:
            pass
        return dst

    def _FnFriendlyExtractError(name: str, e: Exception) -> str:
        low = ("%s %s" % (type(e).__name__, e)).lower()
        if "decrypt" in low or "encrypt" in low or "password" in low:
            return "%s：PDF 有加密／密碼保護，請先解密後再上傳" % name
        if "eof" in low or "trailer" in low or "startxref" in low:
            return "%s：PDF 已損毀或不是標準 PDF，請重新匯出" % name
        return "%s：%s" % (name, e)

    @app.route("/api/ingest/upload", methods=["POST"])
    def ingest_upload():
        target_dir = (request.form.get("target_dir") or "").strip()
        roots = get_search_roots(search_roots)
        if not target_dir or not os.path.isdir(target_dir) or not FnIngestDirOk(target_dir, roots):
            return jsonify({"success": False, "error": "目標目錄不在搜尋範圍內"}), 400
        b_stage = (request.form.get("stage") == "1")
        if b_stage:
            _FnSweepStages()
            dest_dir = os.path.join(_STAGE_ROOT, uuid.uuid4().hex)
            os.makedirs(dest_dir, exist_ok=True)
        else:
            dest_dir = target_dir
        saved = []
        for f in request.files.getlist("files"):
            raw = (f.filename or "").strip()
            name = FnSanitizeFilename(raw)
            ext = os.path.splitext(name)[1].lower()
            if not name or ext not in ALLOWED_EXTS:
                return jsonify({"success": False,
                                "error": "不支援的格式: %s（文件：pptx/ppt/docx/doc/pdf/txt/md/csv/html/eml；圖片：jpg/png/webp/bmp/tiff）" % (raw or "?")}), 400
            dest = os.path.join(dest_dir, name)
            if os.path.exists(dest):
                base, e = os.path.splitext(name)
                i = 2
                while os.path.exists(os.path.join(dest_dir, "%s-%d%s" % (base, i, e))):
                    i += 1
                name = "%s-%d%s" % (base, i, e)
                dest = os.path.join(dest_dir, name)
            try:
                f.save(dest)
                saved.append({"name": name, "path": dest,
                              "size": os.path.getsize(dest)})
            except Exception as e:
                return jsonify({"success": False, "error": str(e)}), 500
        if not saved:
            return jsonify({"success": False, "error": "沒有收到檔案"}), 400
        return jsonify({"success": True, "files": saved, "staged": b_stage})

    @app.route("/api/ingest/summarize", methods=["POST"])
    def ingest_summarize():
        data = request.get_json(silent=True) or {}
        paths = [p for p in (data.get("paths") or []) if p and os.path.isfile(p)]
        if not paths:
            return jsonify({"success": False, "error": "沒有可摘要的檔案"}), 400
        texts, sources, notes = [], [], []
        vision_paths = []
        for p in paths:
            name = os.path.basename(p)
            ext = os.path.splitext(p)[1].lower()
            # Standalone photos/scans: no text layer, straight to eyes.
            if ext in IMAGE_EXTS:
                vision_paths.append(p)
                continue
            try:
                r = FnExtractText(p)
            except Exception as e:
                notes.append(_FnFriendlyExtractError(name, e))
                continue
            if r.get("ok") and (r.get("text") or "").strip():
                texts.append(r["text"])
                sources.append({"path": os.path.abspath(p), "chars": r["chars"],
                                "truncated": r["truncated"]})
                if r["truncated"]:
                    notes.append("%s 超過 %d 字已截斷" % (name, r["chars"]))
                continue
            # No usable text: pdf/pptx may still carry page images for vision.
            if ext in (".pdf", ".pptx"):
                vision_paths.append(p)
            else:
                notes.append("%s：抽不到文字（僅 pdf／pptx／圖片可改走圖片辨識）" % name)
        if texts:
            for p in vision_paths:
                notes.append("%s：無文字未納入本次摘要（圖片型請單批上傳走 vision）"
                             % os.path.basename(p))
            combo = "\n\n===== 下一份文件 =====\n\n".join(texts)
            res = FnChatSummarize(combo, [os.path.basename(p) for p in paths])
            if not res.get("ok"):
                return jsonify({"success": False, "error": res.get("error")}), 502
            return jsonify({"success": True, "summary": res["summary"],
                            "model": res.get("model"), "sources": sources,
                            "notes": notes})
        # All-image batch: open the LLM's eyes (pages/slides -> vision model).
        images, vnotes = [], []
        for p in vision_paths:
            if len(images) >= VISION_MAX_TOTAL:
                vnotes.append("圖片超過 %d 張，只取前 %d 張辨識"
                              % (VISION_MAX_TOTAL, VISION_MAX_TOTAL))
                break
            g = FnExtractImages(p)
            if g.get("ok"):
                for im in g["images"]:
                    if len(images) >= VISION_MAX_TOTAL:
                        break
                    images.append(im)
                if g.get("note"):
                    vnotes.append("%s：%s" % (os.path.basename(p), g["note"]))
            else:
                vnotes.append("%s：%s" % (os.path.basename(p), g.get("error")))
        notes.extend(vnotes)
        if not images:
            return jsonify({"success": False,
                            "error": "；".join(notes) or "沒有可摘要的檔案"}), 400
        res = FnVisionSummarize(images, [os.path.basename(p) for p in vision_paths])
        if not res.get("ok"):
            err = res.get("error") or ""
            if "400" in err:
                return jsonify({"success": False, "error":
                    "目前模型不支援圖片辨識（400）。請到右上 ⚙LLM 切換 "
                    "vision 模型（如 gpt-5）後重試；文字型檔案不受影響"}), 502
            return jsonify({"success": False, "error": err}), 502
        notes.append("👁 圖片辨識摘要（%d 張頁面圖，%s）" % (len(images), res.get("model")))
        return jsonify({"success": True, "summary": res["summary"],
                        "model": res.get("model"),
                        "sources": [{"path": os.path.abspath(p), "chars": 0,
                                     "truncated": False} for p in vision_paths],
                        "notes": notes})

    @app.route("/api/ingest/save", methods=["POST"])
    def ingest_save():
        data = request.get_json(silent=True) or {}
        target_dir = (data.get("target_dir") or "").strip()
        filename = (data.get("filename") or "").strip()
        summary = (data.get("summary_md") or "").strip()
        src_paths = [p for p in (data.get("source_paths") or []) if p and os.path.isfile(p)]
        roots = get_search_roots(search_roots)
        if not target_dir or not os.path.isdir(target_dir) or not FnIngestDirOk(target_dir, roots):
            return jsonify({"success": False, "error": "目標目錄不在搜尋範圍內"}), 400
        if not summary or not src_paths or not filename:
            return jsonify({"success": False, "error": "缺少摘要內文、來源或檔名"}), 400
        repos = scan_doc_repositories(roots)
        repo_root = FnFindOwningRepo(target_dir, repos)
        # Staged files live outside the repo: move them in NOW (confirm time).
        # realpath check keeps this from becoming an arbitrary-file mover.
        stage_root = os.path.realpath(_STAGE_ROOT)
        final_srcs = []
        for p in src_paths:
            a = os.path.realpath(p)
            if a.startswith(stage_root + os.sep):
                if not os.path.isfile(a):
                    return jsonify({"success": False,
                                    "error": "暫存檔已遺失: %s" % os.path.basename(p)}), 400
                final_srcs.append(_FnMoveStagedIntoTarget(a, target_dir))
            else:
                final_srcs.append(os.path.abspath(p))
        src_paths = final_srcs
        rels = []
        for p in src_paths:
            a = os.path.abspath(p)
            rels.append(os.path.relpath(a, repo_root).replace("\\", "/") if repo_root else os.path.basename(a))
        md_path = FnUniqueMdPath(target_dir, filename)
        title = os.path.splitext(os.path.basename(md_path))[0]
        try:
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(FnBuildMd(title, rels, summary,
                                  (data.get("model") or "")))
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
        index_res = None
        if repo_root:
            try:
                index_res = index_repository(repo_root, incremental=True)
                record_log(repo_root, "SAVE_INGEST_MD", target_file=md_path,
                           source_material=", ".join(src_paths),
                           summary=summary[:300])
            except Exception as e:
                index_res = {"success": False, "error": str(e)}
        return jsonify({"success": True, "md_path": md_path,
                        "source_rels": rels, "index": index_res})

    @app.route("/api/ingest/source", methods=["GET"])
    def ingest_source():
        """Serve an ingested source file for the md viewer's source link.

        Query: repo=<abs repo root> & file=<repo-relative path>.
        pdf renders inline in the browser; office files download as
        attachments. realpath checks keep this from becoming an
        arbitrary-file reader.
        """
        repo = (request.args.get("repo") or "").strip()
        rel = (request.args.get("file") or "").strip().replace("/", os.sep)
        roots = get_search_roots(search_roots)
        if not repo or not os.path.isdir(repo) or not FnIngestDirOk(repo, roots):
            return jsonify({"success": False, "error": "repo 不在搜尋範圍內"}), 400
        if not rel or rel in (".", "..") or ".." in rel.split(os.sep):
            return jsonify({"success": False, "error": "非法路徑"}), 400
        repo_real = os.path.realpath(repo)
        target = os.path.realpath(os.path.join(repo_real, rel))
        if not target.startswith(repo_real + os.sep) or not os.path.isfile(target):
            return jsonify({"success": False, "error": "檔案不存在"}), 404
        name = os.path.basename(target)
        ext = os.path.splitext(name)[1].lower()
        if ext == ".pdf":
            return send_file(target, mimetype="application/pdf",
                             as_attachment=False, download_name=name,
                             max_age=0)
        return send_file(target, as_attachment=True, download_name=name,
                         max_age=0)

    @app.route("/api/ingest/delete", methods=["POST"])
    def ingest_delete():
        """Delete an md plus its header-recorded source files, then re-index.

        Body: {path: <abs md path>}. Only .md targets under a search root;
        sources resolve against the owning repo and can never escape it
        (realpath checks). Missing files are reported, not fatal.
        """
        import re
        data = request.get_json(silent=True) or {}
        target = (data.get("path") or "").strip()
        roots = get_search_roots(search_roots)
        if not target:
            return jsonify({"success": False, "error": "缺少路徑"}), 400
        a = os.path.realpath(target)
        if os.path.splitext(a)[1].lower() != ".md":
            return jsonify({"success": False, "error": "僅可刪除 md 文件"}), 400
        real_roots = [os.path.realpath(r) for r in roots if r and os.path.isdir(r)]
        if not any(a == r or a.startswith(r + os.sep) for r in real_roots):
            return jsonify({"success": False, "error": "檔案不在搜尋範圍內"}), 400
        if not os.path.isfile(a):
            return jsonify({"success": False, "error": "檔案不存在"}), 404
        rels = []
        try:
            with open(a, "r", encoding="utf-8", errors="replace") as f:
                for line in f.read().splitlines():
                    m = re.match(r"^> - `(.+)`$", line.strip())
                    if m and m.group(1) not in rels:
                        rels.append(m.group(1))
        except OSError as e:
            return jsonify({"success": False, "error": str(e)}), 500
        repos = scan_doc_repositories(roots)
        repo_root = FnFindOwningRepo(os.path.dirname(a), repos)
        repo_real = os.path.realpath(repo_root) if repo_root else None
        victims = []
        if repo_real:
            for r in rels:
                rel = (r or "").replace("/", os.sep).strip()
                if not rel or ".." in rel.split(os.sep):
                    continue
                s = os.path.realpath(os.path.join(repo_real, rel))
                if s.startswith(repo_real + os.sep) and s != a and s not in victims:
                    victims.append(s)
        victims.append(a)
        deleted, missing = [], []
        for p in victims:
            try:
                if os.path.isfile(p):
                    os.remove(p)
                    deleted.append(p)
                else:
                    missing.append(p)
            except Exception as e:
                missing.append("%s (%s)" % (p, e))
        index_res = None
        if repo_root:
            try:
                index_res = index_repository(repo_root, incremental=True)
                record_log(repo_root, "DELETE_MD_FILE", target_file=a,
                           source_material=", ".join(rels),
                           summary=f"Deleted {len(deleted)} files")
            except Exception as e:
                index_res = {"success": False, "error": str(e)}
        return jsonify({"success": True, "deleted": deleted,
                        "missing": missing, "index": index_res})

    # ---------------- app-wide LLM provider API (/api/llm/*) ----------------
    # Serves the settings dialog AND any future app feature (ingest, chat).
    # Note: FnResolveActiveLLM intentionally has NO route — raw API keys never
    # leave the backend.

    @app.route("/api/llm/providers", methods=["GET"])
    def llm_providers():
        return jsonify(FnListProviders())

    @app.route("/api/llm/providers", methods=["POST"])
    def llm_add_provider():
        data = request.get_json(silent=True) or {}
        try:
            entry = FnAddProvider(data.get("label", ""), data.get("base", ""),
                                  data.get("key", ""), data.get("models") or [],
                                  data.get("strLang", ""))
            return jsonify({"bSuccess": True, "provider": entry})
        except ValueError as e:
            return jsonify({"bSuccess": False, "strError": str(e)}), 400

    @app.route("/api/llm/providers/<pid>", methods=["DELETE"])
    def llm_delete_provider(pid):
        if FnDeleteProvider(pid):
            return jsonify({"bSuccess": True})
        strLang = (request.args.get("strLang") or "")
        bZh = strLang.strip().lower().replace("_", "-").startswith("zh")
        return jsonify({"bSuccess": False,
                        "strError": "僅可刪除自建 provider" if bZh else "Only user-added providers can be deleted"}), 400

    @app.route("/api/llm/providers/<pid>/test", methods=["POST"])
    def llm_test_provider(pid):
        data = request.get_json(silent=True) or {}
        return jsonify(FnTestProvider(pid, data.get("strLang", "")))

    @app.route("/api/llm/providers/models", methods=["POST"])
    def llm_remote_models():
        data = request.get_json(silent=True) or {}
        return jsonify(FnListRemoteModels(data.get("base", ""), data.get("key", "")))

    @app.route("/api/llm/active", methods=["GET"])
    def llm_active_get():
        return jsonify(FnGetActiveLLM())

    @app.route("/api/llm/active", methods=["POST"])
    def llm_active_set():
        data = request.get_json(silent=True) or {}
        return jsonify(FnSetActiveLLM(data.get("provider", ""), data.get("model", "")))

    return app
