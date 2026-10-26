"""Flask web server application factory and RESTful API routing for DocGraphical."""
import json
import os
import shutil
import tempfile
import time
import uuid
from typing import Dict, List, Optional
from flask import Flask, jsonify, request, Response, render_template, send_file
from .config import load_config, save_config, get_search_roots
from .scanner import scan_doc_repositories, get_dir_file_tree, get_repo_doc_metrics
from .parser import extract_toc, extract_section, search_doc, parse_headings
from .db import (
    index_repository, fetch_graph_data, fetch_graph_merged, fts_search,
    get_db_path, get_db_stats, get_indexed_file_set, uninit_repository,
    record_log, get_concepts_tree, get_concept_linked_files, save_concept,
    merge_concepts, delete_concept, unlink_concept_file, attach_concept_to_file, list_repo_markdown_files, get_concept_tag_page, save_concept_tag_page,
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


def _extract_source_rels(text):
    """Source-file rels from ingest header lines (`> - `rel``). Same rule
    the viewer applies client-side; the section endpoint ships them along
    so slice views keep working source-file links."""
    out = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if s.startswith("> - `") and s.endswith("`"):
            r = s[4:-1].strip()
            if r and r not in out:
                out.append(r)
    return out


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
                            "sliced": False, "full_chars": len(content),
                            "sources": _extract_source_rels(content)})

        sec = extract_section(file_path, heading, include_subsections=include_sub)
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                full_text = f.read()
        except OSError:
            full_text = sec
        return jsonify({"heading": heading, "content": sec, "sliced": True,
                        "full_chars": len(full_text),
                        "sources": _extract_source_rels(full_text)})

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
                import ctypes
                try:
                    bitmask = ctypes.windll.kernel32.GetLogicalDrives()
                    for i in range(26):
                        if (bitmask >> i) & 1:
                            drives.append(chr(65 + i) + ":\\")
                except Exception:
                    drives = ["C:\\", "D:\\"]
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
        # Human data survives a rebuild (see db.FnBackupHumanTables): only
        # derived nodes/edges/files are truly rebuilt. A bare reindex must
        # never eat human decisions again.
        from .db import FnBackupHumanTables, FnRestoreHumanTables, get_db_path as _FnDbPath
        _dump = {}
        try:
            _dump = FnBackupHumanTables(_FnDbPath(target_path))
        except Exception:
            _dump = {}
        # Delete old DB then rebuild fresh
        uninit_repository(target_path)
        res = index_repository(target_path)
        _restored = {}
        try:
            _restored = FnRestoreHumanTables(_FnDbPath(target_path), _dump)
        except Exception:
            _restored = {}
        res["human_restored"] = _restored
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
        # Physical concept links: wrap official concept mentions as
        # [name](rel/path/to/tags/name.md) so any md renderer jumps.
        try:
            from .ingest import FnLinkifyConcepts
            _omap: Dict[str, str] = {}
            if repo_root:
                import sqlite3 as _sq
                from .db import get_db_path as _FnDbPath
                _dbp = _FnDbPath(repo_root)
                if _dbp and os.path.isfile(_dbp):
                    _con = _sq.connect(_dbp)
                    try:
                        for _n, _a in _con.execute(
                                "SELECT name, aliases FROM concepts"
                                " WHERE status <> 'candidate'"):
                            if _n:
                                _omap[_n] = _n
                            for _al in ((_a or "").replace("、", ",").split(",")):
                                _al = _al.strip()
                                if _al:
                                    _omap.setdefault(_al, _n)
                    except Exception:
                        pass
                    _con.close()
                if _omap:
                    summary = FnLinkifyConcepts(
                        summary, _omap, os.path.dirname(os.path.abspath(md_path)),
                        os.path.join(os.path.realpath(repo_root), ".docgraphical", "tags"))
        except Exception:
            pass
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
            except Exception as e:
                index_res = {"success": False, "error": str(e)}
            # Logging must never break the index response: own try block.
            try:
                record_log(repo_root, "SAVE_INGEST_MD", target_file=md_path,
                           source_material=", ".join(src_paths),
                           summary=summary[:300])
            except Exception:
                pass
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
            except Exception as e:
                index_res = {"success": False, "error": str(e)}
            # Logging must never break the index response: own try block.
            try:
                record_log(repo_root, "DELETE_MD_FILE", target_file=a,
                           source_material=", ".join(rels),
                           summary=f"Deleted {len(deleted)} files")
            except Exception:
                pass
        return jsonify({"success": True, "deleted": deleted,
                        "missing": missing, "index": index_res})

    @app.route("/api/browse/delete-dir", methods=["POST"])
    def browse_delete_dir():
        '''Recursively delete a directory under an authorized search root, then re-index repo.

        Body: {path: abs dir path}. Refuses repo root itself or paths outside roots.
        '''
        import shutil
        data = request.get_json(silent=True) or {}
        target = (data.get("path") or "").strip()
        roots = get_search_roots(search_roots)
        if not target:
            return jsonify({"success": False, "error": "缺少目錄路徑"}), 400
        a = os.path.realpath(target)
        if not os.path.isdir(a):
            return jsonify({"success": False, "error": "目錄不存在"}), 404
        real_roots = [os.path.realpath(r) for r in roots if r and os.path.isdir(r)]
        # Must be strictly under at least one search root (not equal to root itself)
        if not any(a.startswith(r + os.sep) for r in real_roots):
            return jsonify({"success": False, "error": "不可刪除專案根目錄或搜尋範圍外目錄"}), 400
        repos = scan_doc_repositories(roots)
        repo_root = FnFindOwningRepo(a, repos)
        repo_real = os.path.realpath(repo_root) if repo_root else None
        if repo_real and a == repo_real:
            return jsonify({"success": False, "error": "禁止刪除整個專案倉庫根目錄"}), 400

        try:
            shutil.rmtree(a)
        except OSError as e:
            return jsonify({"success": False, "error": f"刪除目錄失敗: {e}"}), 500

        index_res = None
        if repo_root:
            try:
                index_res = index_repository(repo_root, incremental=True)
            except Exception as e:
                index_res = {"success": False, "error": str(e)}
            try:
                record_log(repo_root, "DELETE_DIR", target_file=a,
                           source_material="",
                           summary=f"Recursively deleted folder {os.path.basename(a)}")
            except Exception:
                pass
        return jsonify({"success": True, "deleted": a, "index": index_res})

    # ---------------- app-wide LLM provider API (/api/llm/*) ----------------
    # Serves the settings dialog AND any future app feature (ingest, chat).
    # Note: FnResolveActiveLLM intentionally has NO route — raw API keys never
    # leave the backend.

    @app.route("/api/llm/opencode-presets", methods=["GET"])
    def llm_opencode_presets():
        from .llm_provider import FnGetOpencodePresets
        return jsonify(FnGetOpencodePresets())

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
        return jsonify(FnListRemoteModels(data.get("base", ""), data.get("key", ""), data.get("strLang", "zh")))

    @app.route("/api/llm/active", methods=["GET"])
    def llm_active_get():
        return jsonify(FnGetActiveLLM())

    @app.route("/api/llm/active", methods=["POST"])
    def llm_active_set():
        data = request.get_json(silent=True) or {}
        return jsonify(FnSetActiveLLM(data.get("provider", ""), data.get("model", "")))

    

    # ─── Concepts Registry RESTful Endpoints ──────────────────────────

    def _resolve_repo(repo_val: str, target_file: str = "") -> str:
        repos = scan_doc_repositories(get_search_roots())
        repo_list = []
        if repo_val and repo_val.strip():
            # If comma-separated, split candidates
            parts = [p.strip() for p in repo_val.split(",") if p.strip()]
            for p in parts:
                if os.path.isdir(p):
                    repo_list.append(os.path.realpath(p))
        if not repo_list:
            if isinstance(repos, dict) and repos:
                for v in repos.values():
                    p = v.get("path", "") if isinstance(v, dict) else str(v)
                    if p and os.path.isdir(p):
                        repo_list.append(os.path.realpath(p))
            elif isinstance(repos, list) and repos:
                for v in repos:
                    p = v.get("path", "") if isinstance(v, dict) else str(v)
                    if p and os.path.isdir(p):
                        repo_list.append(os.path.realpath(p))

        if target_file and repo_list:
            clean_tf = target_file.strip().replace("/", os.sep).replace("\\", os.sep)
            # If target_file is absolute
            if os.path.isabs(clean_tf) and os.path.exists(clean_tf):
                real_tf = os.path.realpath(clean_tf)
                for r in repo_list:
                    if real_tf == r or real_tf.startswith(r + os.sep):
                        return r
            # If target_file is relative, test which repo contains it
            for r in repo_list:
                candidate = os.path.realpath(os.path.join(r, clean_tf))
                if os.path.exists(candidate):
                    return r

        return repo_list[0] if repo_list else (repo_val.split(",")[0].strip() if repo_val else "")

    def _resolve_repos(repo_val: str):
        """Multi-repo version of _resolve_repo: comma-split, realpath'd,
        existing dirs first, else every scanned repo. One canonical listing
        for all fan-out endpoints (was copy-pasted ~10 times)."""
        out = []
        if repo_val and repo_val.strip():
            for p in (x.strip() for x in repo_val.split(",") if x.strip()):
                if os.path.isdir(p):
                    rp = os.path.realpath(p)
                    if rp not in out:
                        out.append(rp)
        if not out:
            try:
                all_r = scan_doc_repositories(get_search_roots())
            except Exception:
                all_r = []
            vals = all_r.values() if isinstance(all_r, dict) else (all_r or [])
            for v in vals:
                p = v.get("path", "") if isinstance(v, dict) else str(v)
                if p and p not in out:
                    out.append(p)
        return out

    @app.route("/api/concepts", methods=["GET"])
    def api_get_concepts():
        repo_arg = request.args.get("repo", "").strip()
        repos_list = _resolve_repos(repo_arg)

        if not repos_list:
            return jsonify({"ok": True, "tree": {}, "candidates": [], "counts": {"official": 0, "candidates": 0}})

        # Aggregate concepts across repos
        merged_tree = {}
        merged_candidates = []
        seen_names = set()

        for rp in repos_list:
            res = get_concepts_tree(rp)
            if not res or not res.get("ok"):
                continue
            for cat, items in (res.get("tree") or {}).items():
                if cat not in merged_tree:
                    merged_tree[cat] = []
                for it in items:
                    if it["name"] not in seen_names:
                        seen_names.add(it["name"])
                        merged_tree[cat].append(it)
            for cand in (res.get("candidates") or []):
                if cand["name"] not in seen_names:
                    seen_names.add(cand["name"])
                    merged_candidates.append(cand)

        total_official = sum(len(v) for v in merged_tree.values())
        return jsonify({
            "ok": True,
            "tree": merged_tree,
            "candidates": merged_candidates,
            "counts": {"official": total_official, "candidates": len(merged_candidates)}
        })

    @app.route("/api/concepts", methods=["POST"])
    def api_save_concept():
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        name = (data.get("name") or "").strip()
        raw_cat = (data.get("category") or "").strip()
        category = "Uncategorized" if (not raw_cat or raw_cat in ("未分類", "Uncategorized")) else raw_cat
        aliases = (data.get("aliases") or "").strip()
        status = (data.get("status") or "official").strip()
        if not repo or not name:
            return jsonify({"ok": False, "error": "Repo and concept name are required"}), 400
        res = save_concept(repo, name, category, aliases, status)
        # Step 5 of the vine crawl: a fresh official tag materializes its
        # kept staged links/tags into the staged files (additive, ignored
        # on failure). Candidates do NOT trigger this.
        if (res or {}).get("ok") and status != "candidate":
            try:
                from .crawl import FnApplyStaged
                applied = FnApplyStaged(repo, name)
                if isinstance(applied, dict) and applied.get("applied"):
                    res["staged_applied"] = applied.get("applied")
                    try:
                        from .db import index_repository
                        index_repository(repo, incremental=True)
                    except Exception:
                        pass
            except Exception:
                pass
        return jsonify(res)

    @app.route("/api/concepts/files", methods=["GET"])
    def api_get_concept_files():
        repo_raw = request.args.get("repo", "").strip()
        repo = repo_raw if repo_raw else _resolve_repo("")
        name = request.args.get("name", "").strip()
        if not name:
            return jsonify({"ok": False, "error": "Concept name is required"}), 400
        return jsonify(get_concept_linked_files(repo, name))

    @app.route("/api/concepts/delete", methods=["POST"])
    def api_delete_concept():
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        name = (data.get("name") or "").strip()
        clean_disk = data.get("cleanDisk", True)
        if not repo or not name:
            return jsonify({"ok": False, "error": "Repo and concept name are required"}), 400
        return jsonify(delete_concept(repo, name, clean_disk))

    @app.route("/api/concepts/merge", methods=["POST"])
    def api_merge_concepts():
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        src = (data.get("source") or "").strip()
        tgt = (data.get("target") or "").strip()
        add_alias = data.get("addAsAlias", True)
        if not repo or not src or not tgt:
            return jsonify({"ok": False, "error": "Repo, source and target are required"}), 400
        return jsonify(merge_concepts(repo, src, tgt, add_alias))

    
    @app.route("/api/repo/doc-files", methods=["GET"])
    def api_get_repo_doc_files():
        repo = _resolve_repo(request.args.get("repo", ""))
        if not repo:
            return jsonify({"ok": False, "error": "No repo found"}), 400
        return jsonify({"ok": True, "repo": repo, "files": list_repo_markdown_files(repo)})

    @app.route("/api/concepts/attach", methods=["POST"])
    def api_attach_concept():
        data = request.get_json(silent=True) or {}
        file_path = (data.get("filePath") or "").strip()
        repo = _resolve_repo(data.get("repo") or "", target_file=file_path)
        name = (data.get("name") or "").strip()
        file_path = (data.get("filePath") or "").strip()
        heading = (data.get("heading") or "").strip()
        if not repo or not name or not file_path:
            return jsonify({"ok": False, "error": "Repo, concept name and filePath required"}), 400
        res = attach_concept_to_file(repo, name, file_path, heading=heading)
        return jsonify(res)

    @app.route("/api/concepts/tag-page", methods=["GET"])
    def api_get_concept_tag_page():
        repo_raw = request.args.get("repo", "").strip()
        repo = repo_raw if repo_raw else _resolve_repo("")
        name = request.args.get("name", "").strip()
        if not name:
            return jsonify({"ok": False, "error": "Concept name is required"}), 400
        return jsonify(get_concept_tag_page(repo, name))

    @app.route("/api/concepts/tag-page", methods=["POST"])
    def api_save_concept_tag_page():
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        name = (data.get("name") or "").strip()
        content = data.get("content", "")
        if not repo or not name:
            return jsonify({"ok": False, "error": "Repo and concept name required"}), 400
        return jsonify(save_concept_tag_page(repo, name, content))

    @app.route("/api/concepts/unlink", methods=["POST"])
    def api_unlink_concept():
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        name = (data.get("name") or "").strip()
        file_path = (data.get("filePath") or "").strip()
        rewrite_disk = data.get("rewriteDisk", True)
        if not repo or not name or not file_path:
            return jsonify({"ok": False, "error": "Repo, concept name and filePath are required"}), 400
        return jsonify(unlink_concept_file(repo, name, file_path, rewrite_disk))

    @app.route("/api/concepts/scan", methods=["POST"])
    def api_scan_concepts():
        """llm-scan two-stage: CPU mines cross-doc terms, LLM judges,
        approved terms land in the candidates pool. One LLM call max."""
        from .concept_scan import FnRunScan
        data = request.get_json(silent=True) or {}
        repo_arg = (data.get("repo") or "").strip()
        repos_list = _resolve_repos(repo_arg)
        if not repos_list:
            return jsonify({"ok": False, "error": "No repositories to scan"}), 400
        agg = {"ok": True, "mined": 0, "judged": 0, "inserted": [],
               "model": "", "repos": []}
        mode = (data.get("mode") or "full").strip()
        dry_run = bool(data.get("dry_run"))
        # Force a fresh corpus re-mine (UI「重新掃描」鈕), bypassing the
        # fingerprint+TTL cache inside FnMineCorpus.
        refresh = bool(data.get("refresh"))
        exclude = data.get("exclude") or []
        if not isinstance(exclude, list):
            exclude = []
        try:
            max_new = int(data.get("max_new", 3))
        except (TypeError, ValueError):
            max_new = 3
        # Global budget shared across ALL repos in this call (not per repo).
        budget = max(1, min(20, max_new))
        try:
            min_tf = int(data.get("min_tf", 5))
        except (TypeError, ValueError):
            min_tf = 5
        min_tf = max(1, min_tf)
        for rp in repos_list:
            db_p = get_db_path(rp)
            if not db_p:
                continue
            # Dry-run reviews must be side-effect free (except the audit
            # line below): skip even the free recount so closing the dialog
            # abandons literally everything.
            recount = {"updated": 0}
            if not dry_run:
                try:
                    # Free recount first: existing candidates' DF/TF refresh
                    # with zero tokens, before any LLM judging below.
                    from .concept_scan import FnRecountCandidates
                    recount = FnRecountCandidates([rp], db_p)
                except Exception:
                    recount = {"updated": 0}
            if mode == "recount":
                rep = {"ok": True, "mined": 0, "judged": 0, "inserted": [],
                       "model": "", "note": "僅更新引用數，未花 LLM"}
            else:
                if budget <= 0:
                    # Global budget exhausted: still recount, no more mining.
                    rep = {"ok": True, "mined": 0, "judged": 0, "inserted": [],
                           "model": "", "note": "名額已用完，後面的庫只更新數字"}
                else:
                    try:
                        rep = FnRunScan([rp], db_p, max_new=budget, min_tf=min_tf,
                                        dry_run=dry_run, exclude=exclude,
                                        refresh=refresh)
                    except Exception as e:
                        rep = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
                    if rep.get("ok"):
                        budget -= len(rep.get("inserted", []))
            rep["recounted"] = recount.get("updated", 0)
            agg["repos"].append({"repo": rp, "report": rep})
            if rep.get("ok"):
                agg["mined"] += rep.get("mined", 0)
                agg["judged"] += rep.get("judged", 0)
                agg["inserted"].extend(
                    dict(x, repo=rp) for x in rep.get("inserted", []))
                if rep.get("model") and not agg["model"]:
                    agg["model"] = rep["model"]
            try:
                record_log(rp, "CONCEPT_SCAN",
                           summary="%smined=%d judged=%d inserted=%d model=%s" % (
                               "dryrun " if dry_run else "",
                               rep.get("mined", 0), rep.get("judged", 0),
                               len(rep.get("inserted", [])) if rep.get("ok") else 0,
                               rep.get("model", "") or "-"))
            except Exception:
                pass
        if not agg["inserted"]:
            agg["note"] = "掃過全庫，沒有新面孔"
        return jsonify(agg)

    @app.route("/api/concepts/scan/evidence", methods=["GET"])
    def api_scan_evidence():
        """DF/TF/snippets per mined term (potential display for the pool).

        Edge-refs are 0 for unbracketed mined terms by construction; this
        endpoint reports what mining actually saw: document/testimony counts
        plus one evidence snippet each."""
        import sqlite3
        repo_arg = (request.args.get("repo") or "").strip()
        repos_list = _resolve_repos(repo_arg)
        out = {}
        for rp in repos_list:
            try:
                db_p = get_db_path(rp)
            except Exception:
                continue
            if not db_p or not os.path.isfile(db_p):
                continue
            try:
                # Ensure v2 evidence columns even for pre-migration rows.
                from .concept_scan import FnEnsureScanTables
                FnEnsureScanTables(db_p)
                con = sqlite3.connect(db_p)
                try:
                    rows = con.execute(
                        "SELECT term, sources_json, score, model, df, tf"
                        " FROM scan_evidence").fetchall()
                except Exception:
                    rows = []
                con.close()
            except Exception:
                continue
            for term, sj, score, model, df, tf in rows:
                try:
                    files = json.loads(sj or "[]")
                except Exception:
                    files = []
                cur = out.get(term)
                if cur is None or (df or 0) > (cur.get("df") or 0):
                    out[term] = {"df": df or 0, "tf": tf or 0,
                                 "files": files[:5], "model": model or "",
                                 "repo": rp}
        return jsonify({"ok": True, "evidence": out})

    @app.route("/api/concepts/scan/recount-one", methods=["POST"])
    def api_scan_recount_one():
        """Per-card refresh, Prospect method: recount DF/TF/snippets for ONE
        term PLUS top up missing staged spots (evidence files with no kept
        row get link+tag rows, concept bound). Pure CPU, zero LLM.
        Body: {repo?, term}."""
        from .concept_scan import FnRecountOneTerm
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        term = (data.get("term") or "").strip()
        if not repo:
            return jsonify({"ok": False, "error": "no repository"}), 400
        if not term:
            return jsonify({"ok": False, "error": "term required"}), 400
        try:
            from .db import get_db_path as _FnDbPath
            res = FnRecountOneTerm([repo], _FnDbPath(repo), term)
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        if not res.get("ok"):
            return jsonify(res), 400
        try:
            from .crawl import FnRecountTopUpStaged
            top = FnRecountTopUpStaged(_FnDbPath(repo), repo, term)
            res["staged_added"] = top.get("added", 0) if top.get("ok") else 0
            if top.get("skipped"):
                res["topup_skipped"] = top["skipped"]
        except Exception:
            res["staged_added"] = 0
        return jsonify(res)

    @app.route("/api/concepts/scan/blacklist", methods=["GET"])
    def api_scan_blacklist():
        """List globally rejected terms (rejected_terms table).

        Dismissals land here (see unlink global-wildcard hook); removing
        a row makes the term eligible for future scans again.
        """
        import sqlite3
        repo_arg = (request.args.get("repo") or "").strip()
        repos_list = _resolve_repos(repo_arg)
        out = []
        for rp in repos_list:
            try:
                db_p = get_db_path(rp)
            except Exception:
                continue
            if not db_p or not os.path.isfile(db_p):
                continue
            try:
                from .concept_scan import FnEnsureScanTables
                FnEnsureScanTables(db_p)
                con = sqlite3.connect(db_p)
                try:
                    rows = con.execute(
                        "SELECT term, decided_by, decided_at"
                        " FROM rejected_terms ORDER BY decided_at DESC").fetchall()
                except Exception:
                    rows = []
                con.close()
            except Exception:
                continue
            for term, by, at in rows:
                if term and not any(x["term"] == term for x in out):
                    out.append({"term": term, "decided_by": by or "",
                                "decided_at": at or "", "repo": rp})
        return jsonify({"ok": True, "blacklist": out, "count": len(out)})

    @app.route("/api/concepts/scan/blacklist/remove", methods=["POST"])
    def api_scan_blacklist_remove():
        """Un-blacklist a term: future scans may discover it again.

        restore=true also puts it straight back into the candidates pool
        (re-insert candidate row; its evidence row was never deleted).
        """
        import sqlite3
        import time as _time
        data = request.get_json(silent=True) or {}
        term = (data.get("term") or "").strip()
        repo_arg = (data.get("repo") or "").strip()
        restore = bool(data.get("restore"))
        if not term:
            return jsonify({"ok": False, "error": "term required"}), 400
        repos_list = _resolve_repos(repo_arg)
        removed = 0
        for rp in repos_list:
            try:
                db_p = get_db_path(rp)
            except Exception:
                continue
            if not db_p or not os.path.isfile(db_p):
                continue
            try:
                con = sqlite3.connect(db_p)
                try:
                    cur = con.execute(
                        "DELETE FROM rejected_terms WHERE term = ?", (term,))
                    removed += cur.rowcount or 0
                    if restore:
                        con.execute(
                            "INSERT OR IGNORE INTO concepts"
                            "(name, category, aliases, status, created_at)"
                            " VALUES(?, '機器挖掘', '', 'candidate', ?)",
                            (term, _time.strftime("%Y-%m-%d %H:%M:%S")))
                    con.commit()
                except Exception:
                    pass
                con.close()
            except Exception:
                continue
            try:
                record_log(rp, "BLACKLIST_REMOVE", target_file=term,
                           summary=("restored to candidates by human"
                                    if restore else "un-blacklisted by human"))
            except Exception:
                pass
        return jsonify({"ok": True, "term": term, "removed": removed,
                        "restored": bool(restore)})

    @app.route("/api/concepts/scan/candidates/remove", methods=["POST"])
    def api_scan_candidate_remove():
        """Plain remove from the pool: drops the candidate row and its
        wiki_link edges, but does NOT blacklist (a rescan may rediscover
        it). Disk files are never touched. For permanent removal use the
        blacklist flow (dismiss with filePath='*')."""
        import sqlite3
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        repo_arg = (data.get("repo") or "").strip()
        if not name:
            return jsonify({"ok": False, "error": "name required"}), 400
        repos_list = _resolve_repos(repo_arg)
        removed = 0
        for rp in repos_list:
            try:
                db_p = get_db_path(rp)
            except Exception:
                continue
            if not db_p or not os.path.isfile(db_p):
                continue
            try:
                con = sqlite3.connect(db_p)
                try:
                    cur = con.execute(
                        "DELETE FROM concepts WHERE name = ? AND status = 'candidate'",
                        (name,))
                    removed += cur.rowcount or 0
                    con.execute(
                        "DELETE FROM edges WHERE target IN (?, ?) AND kind = 'wiki_link'",
                        ("concept::" + name, name))
                    con.execute("DELETE FROM scan_evidence WHERE term = ?", (name,))
                    con.commit()
                except Exception:
                    pass
                con.close()
            except Exception:
                continue
            try:
                record_log(rp, "CANDIDATE_REMOVE", target_file=name,
                           summary="removed from pool, not blacklisted")
            except Exception:
                pass
        return jsonify({"ok": True, "name": name, "removed": removed})

    @app.route("/api/concepts/scan/confirm", methods=["POST"])
    def api_scan_confirm():
        """Commit a reviewed dry-run: insert approved as candidates,
        blacklist the rejected. One transaction per repo (no half writes).

        Body: {repo?, approve: [{term, df, tf, files, reason}],
               reject: [term]}. Terms are re-validated server-side
        (format + not-already-decided); failures listed per term.
        """
        import sqlite3
        import time as _time
        data = request.get_json(silent=True) or {}
        repo_arg = (data.get("repo") or "").strip()
        approve = data.get("approve") or []
        reject = data.get("reject") or []
        if not isinstance(approve, list):
            approve = []
        if not isinstance(reject, list):
            reject = []
        repos_list = _resolve_repos(repo_arg)
        if not repos_list:
            return jsonify({"ok": False, "error": "No repositories to scan"}), 400
        from .concept_scan import FnEnsureScanTables
        from .crawl import FnEnsureStagedTables
        approved, rejected, skipped = [], [], []
        for rp in repos_list:
            try:
                db_p = get_db_path(rp)
            except Exception:
                continue
            if not db_p or not os.path.isfile(db_p):
                continue
            try:
                FnEnsureScanTables(db_p)
                FnEnsureStagedTables(db_p)
                con = sqlite3.connect(db_p)
                try:
                    known = {r[0] for r in
                             con.execute("SELECT name FROM concepts")}
                    rej = {r[0] for r in
                           con.execute("SELECT term FROM rejected_terms")}
                except Exception:
                    known, rej = set(), set()
                now = _time.strftime("%Y-%m-%d %H:%M:%S")
                for item in approve:
                    term = ((item or {}).get("term") or "").strip()
                    if not term or len(term) > 30:
                        skipped.append(term)
                        continue
                    # Per-item repo routing (vine items carry theirs): items
                    # naming a different repo do not belong in this db.
                    # Items without repo keep legacy fan-out behavior.
                    _ir = ((item or {}).get("repo") or "").strip()
                    if _ir and os.path.abspath(_ir) != os.path.abspath(rp):
                        continue
                    if term in known or term in rej:
                        skipped.append(term)
                        continue
                    it = item or {}
                    try:
                        con.execute(
                            "INSERT OR IGNORE INTO concepts"
                            "(name, category, aliases, status, created_at)"
                            " VALUES(?, '機器挖掘', '', 'candidate', ?)",
                            (term, now))
                        con.execute(
                            "INSERT OR REPLACE INTO scan_evidence"
                            "(term, sources_json, score, model, created_at, df, tf)"
                            " VALUES(?, ?, ?, ?, ?, ?, ?)",
                            (term, json.dumps(it.get("files", []), ensure_ascii=False),
                             0, it.get("model", ""), now,
                             int(it.get("df") or 0), int(it.get("tf") or 0)))
                        approved.append(term)
                        known.add(term)
                        # ② staged like ③: the human's approval IS the judge,
                        # so rows land 'kept' with concept bound at once (the
                        # mined mention is the evidence). On promote the same
                        # FnApplyStaged aligns hyperlinks for both flows.
                        try:
                            from .crawl import FnStageApproved
                            FnStageApproved(con, rp, term, it.get("files"), now)
                        except Exception:
                            pass
                    except Exception:
                        skipped.append(term)
                        continue
                for term in reject:
                    term = (term or "").strip()
                    if not term:
                        continue
                    try:
                        con.execute(
                            "INSERT OR IGNORE INTO rejected_terms"
                            "(term, decided_by, decided_at)"
                            " VALUES(?, 'scan-dialog', ?)", (term, now))
                        con.execute(
                            "DELETE FROM concepts WHERE name = ? AND status = 'candidate'",
                            (term,))
                        rejected.append(term)
                    except Exception:
                        continue
                con.commit()
                con.close()
            except Exception:
                continue
            try:
                record_log(rp, "CONCEPT_SCAN_CONFIRM",
                           summary="approved=%d rejected=%d skipped=%d" % (
                               len(approved), len(rejected), len(skipped)))
            except Exception:
                pass
        return jsonify({"ok": True, "approved": approved,
                        "rejected": rejected, "skipped": skipped})

    @app.route("/api/vine/map", methods=["GET"])
    def api_vine_map():
        """Whole-map overview for the guide (files x concepts + inventories)."""
        from .vine import FnVineMap
        repo_arg = (request.args.get("repo") or "").strip()
        repos_list = _resolve_repos(repo_arg)
        out = []
        for rp in repos_list:
            try:
                db_p = get_db_path(rp)
            except Exception:
                continue
            if not db_p:
                continue
            try:
                m = FnVineMap(db_p)
            except Exception as e:
                m = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
            m["repo"] = rp
            out.append(m)
        return jsonify({"ok": True, "maps": out})

    @app.route("/api/vine/walk", methods=["POST"])
    def api_vine_walk():
        """Walk from seed(s) up to depth (clamped 1..2 in vine.py).

        Body: {seed | seeds[], depth?, repo?}. CPU only, zero LLM cost.
        Newcomers carry evidence (file + line) for review UI.
        """
        from .vine import FnVineWalk, FnResolveSeed
        data = request.get_json(silent=True) or {}
        seeds = data.get("seeds") or []
        if data.get("seed") and data["seed"] not in seeds:
            seeds = [data["seed"]] + list(seeds)
        seeds = [str(s).strip() for s in seeds if str(s or "").strip()][:5]
        if not seeds:
            return jsonify({"ok": False, "error": "seed required"}), 400
        try:
            depth = int(data.get("depth", 1))
        except (TypeError, ValueError):
            depth = 1
        # Junction rounds pass visited back in (["file"|"concept", id]
        # pairs); Walk skips them so no station is visited twice.
        visited_in = []
        try:
            for pair in (data.get("visited") or []):
                if (isinstance(pair, (list, tuple)) and len(pair) == 2
                        and pair[0] in ("file", "concept")):
                    visited_in.append((pair[0], str(pair[1])))
        except Exception:
            visited_in = []
        repo_arg = (data.get("repo") or "").strip()
        repos_list = _resolve_repos(repo_arg)
        if not repos_list:
            return jsonify({"ok": False, "error": "No repositories to walk"}), 400
        walks, newcomers, visited_all, resolved = [], [], set(), []
        for rp in repos_list:
            try:
                db_p = get_db_path(rp)
            except Exception:
                continue
            if not db_p:
                continue
            for s in seeds:
                try:
                    rs = FnResolveSeed(db_p, s)
                except Exception as e:
                    rs = {"ok": False,
                          "error": "%s: %s" % (type(e).__name__, e)}
                starts = (rs.get("starts") or []) if rs.get("ok") else []
                if not starts:
                    walks.append({"ok": True, "seed": s, "depth": depth,
                                  "path": [s], "newcomers": [], "visited": [],
                                  "repo": rp, "start": s,
                                  "note": (rs.get("note") or rs.get("error")
                                           or "seed not found")})
                    resolved.append({"seed": s, "repo": rp, "starts": [],
                                     "note": "nothing found"})
                    continue
                resolved.append({"seed": s, "repo": rp,
                                 "starts": [("file::" + x["id"]
                                             if x["kind"] == "file" else x["id"])
                                            for x in starts],
                                 "note": rs.get("note", "")})
                for st in starts[:6]:
                    sid = (("file::" + st["id"]) if st["kind"] == "file"
                           else st["id"])
                    try:
                        w = FnVineWalk(db_p, sid, depth=depth,
                                       visited=visited_in)
                    except Exception as e:
                        w = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
                    w["repo"] = rp
                    w["seed"] = s
                    w["start"] = sid
                    walks.append(w)
                    if w.get("ok"):
                        for v in w.get("visited", []):
                            visited_all.add(v)
                        for nc in w.get("newcomers", []):
                            if not any(x["name"] == nc["name"] for x in newcomers):
                                newcomers.append(dict(nc, repo=rp))
            try:
                record_log(rp, "VINE_WALK",
                           summary="seeds=%d depth=%d newcomers=%d" % (
                               len(seeds), depth, len(newcomers)))
            except Exception:
                pass
        return jsonify({"ok": True, "walks": walks, "newcomers": newcomers,
                        "visited": sorted(visited_all), "resolved": resolved})

    @app.route("/api/vine/neighbors", methods=["GET"])
    def api_vine_neighbors():
        """One-hop neighborhood for a junction pick (files x concepts x
        headings with snippets). Params: repo (single), seed."""
        from .vine import FnVineNeighbors
        repo = (request.args.get("repo") or "").strip()
        seed = (request.args.get("seed") or "").strip()
        if not repo or not seed:
            return jsonify({"ok": False,
                            "error": "repo and seed required"}), 400
        try:
            db_p = get_db_path(repo)
        except Exception:
            db_p = None
        if not db_p:
            return jsonify({"ok": False, "error": "unknown repo"}), 400
        try:
            nb = FnVineNeighbors(db_p, seed)
        except Exception as e:
            nb = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        nb["repo"] = repo
        return jsonify(nb)

    @app.route("/api/vine/guide", methods=["POST"])
    def api_vine_guide():
        """Single route-planning LLM call. Caller builds options; guide picks.

        Body: {messages: [...]}. Returns {ok, text, model}.
        """
        from .vine import FnVineGuide
        data = request.get_json(silent=True) or {}
        messages = data.get("messages") or []
        if not isinstance(messages, list) or not messages:
            return jsonify({"ok": False, "error": "messages required"}), 400
        try:
            res = FnVineGuide(messages)
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        if not res.get("ok"):
            return jsonify(res), 502
        try:
            record_log("", "VINE_GUIDE",
                       summary="model=%s" % (res.get("model") or "-"))
        except Exception:
            pass
        return jsonify(res)

    @app.route("/api/prompts", methods=["GET"])
    def api_get_prompts():
        """Retrieve all active prompt templates and defaults for all languages."""
        from .prompts import FnLoadPrompts, DEFAULT_PROMPTS
        return jsonify({"ok": True, "prompts": FnLoadPrompts(), "defaults": DEFAULT_PROMPTS})

    @app.route("/api/prompts/save", methods=["POST"])
    def api_save_prompt():
        """Save/update a single prompt template."""
        from .prompts import FnSavePrompt
        data = request.get_json(silent=True) or {}
        key = (data.get("key") or "").strip()
        system = data.get("system", "")
        template = data.get("template", "")
        name = data.get("name", "")
        if not key:
            return jsonify({"ok": False, "error": "key required"}), 400
        res = FnSavePrompt(key, system, template, name)
        return jsonify(res)

    @app.route("/api/prompts/reset", methods=["POST"])
    def api_reset_prompt():
        """Reset a prompt template to the default for a specific language."""
        from .prompts import FnResetPromptToDefault
        data = request.get_json(silent=True) or {}
        key = (data.get("key") or "").strip()
        lang = (data.get("lang") or "zh").strip().lower()
        if not key:
            return jsonify({"ok": False, "error": "key required"}), 400
        res = FnResetPromptToDefault(key, lang)
        return jsonify(res)

    @app.route("/api/crawl/start", methods=["POST"])
    def api_crawl_start():
        """Emperor crawl step 1: user seed -> literal + LLM semantic
        footholds -> LIFO stack. Body: {repo?, seed (required), max_starts?, lang?}.
        1 LLM call. No seed, no crawl."""
        from .crawl import FnCrawlStart
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        seed = ((data.get("seed") or "").strip())[:200]
        lang = (data.get("lang") or "zh").strip().lower()[:2] or "zh"
        if not repo:
            return jsonify({"ok": False, "error": "no repository"}), 400
        if not seed:
            return jsonify({"ok": False, "error": "seed required"}), 400
        try:
            max_starts = int(data.get("max_starts", 3))
        except (TypeError, ValueError):
            max_starts = 3
        try:
            res = FnCrawlStart(repo, seed, max_starts=max_starts, lang=lang)
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        if not res.get("ok"):
            return jsonify(res), 502 if "guide" in str(res.get("error", "")) else 400
        return jsonify(res)

    @app.route("/api/crawl/next", methods=["POST"])
    def api_crawl_next():
        """Steps 2-3: pop ONE node (LIFO). FILE nodes cost 1 LLM call
        (read + judge next); CONCEPT nodes expand via CPU edges, free.
        Body: {run_id, max_files?}."""
        from .crawl import FnCrawlNext
        data = request.get_json(silent=True) or {}
        run_id = (data.get("run_id") or "").strip()
        if not run_id:
            return jsonify({"ok": False, "error": "run_id required"}), 400
        try:
            max_files = int(data.get("max_files", 10))
        except (TypeError, ValueError):
            max_files = 10
        try:
            res = FnCrawlNext(run_id, max_files=max_files)
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        return jsonify(res)

    @app.route("/api/crawl/finish", methods=["POST"])
    def api_crawl_finish():
        """Step 4: ONE LLM call judges all staged + recommends ONE title.
        Body: {run_id}."""
        from .crawl import FnCrawlFinish
        data = request.get_json(silent=True) or {}
        run_id = (data.get("run_id") or "").strip()
        if not run_id:
            return jsonify({"ok": False, "error": "run_id required"}), 400
        try:
            res = FnCrawlFinish(run_id)
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        if not res.get("ok"):
            return jsonify(res), 502
        return jsonify(res)

    @app.route("/api/crawl/run", methods=["POST"])
    def api_crawl_run():
        """The whole crawl flow in ONE call (steps 1-4 minus human edit).

        Long call (minutes, one LLM pass per file). The dialog does NOT
        use this (it loops the step endpoints for per-file progress);
        scripts and MCP do. Confirm stays a separate human-gated call.
        Body: {repo?, seed (required), max_starts?, max_files?}."""
        from .crawl import FnCrawlRun
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        seed = ((data.get("seed") or "").strip())[:200]
        if not repo:
            return jsonify({"ok": False, "error": "no repository"}), 400
        if not seed:
            return jsonify({"ok": False, "error": "seed required"}), 400
        try:
            max_starts = int(data.get("max_starts", 3))
        except (TypeError, ValueError):
            max_starts = 3
        try:
            max_files = int(data.get("max_files", 10))
        except (TypeError, ValueError):
            max_files = 10
        try:
            res = FnCrawlRun(repo, seed, max_starts=max_starts, max_files=max_files)
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        if not res.get("ok"):
            return jsonify(res), 502
        return jsonify(res)

    @app.route("/api/crawl/refresh", methods=["POST"])
    def api_crawl_refresh():
        """Pure Vine refresh: re-crawl seeded by an EXISTING candidate
        title; fresh kept rows merge into ITS draft (concept bound).
        Never creates a candidate. Long call (minutes, LLM per file).
        Body: {repo?, name, max_files?}."""
        from .crawl import FnCrawlRefresh
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        name = (data.get("name") or "").strip()
        if not repo or not name:
            return jsonify({"ok": False, "error": "repo and name required"}), 400
        try:
            max_files = int(data.get("max_files", 10))
        except (TypeError, ValueError):
            max_files = 10
        try:
            res = FnCrawlRefresh(repo, name, max_files=max_files)
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        if not res.get("ok"):
            return jsonify(res), 400
        return jsonify(res)

    @app.route("/api/crawl/sweep", methods=["POST"])
    def api_crawl_sweep():
        """GC for staged rows: dead-run staged, old dropped, orphan kept.
        Body: {repo?}. Same sweep piggybacks every crawl start."""
        from .crawl import FnSweepStaged
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo(data.get("repo") or "")
        if not repo:
            return jsonify({"ok": False, "error": "no repository"}), 400
        try:
            res = FnSweepStaged(repo)
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        return jsonify(res)

    @app.route("/api/crawl/confirm", methods=["POST"])
    def api_crawl_confirm():
        """Human-edited title -> candidate pool; staged rows bound to it.
        Disk untouched (application waits for promote). Body: {run_id, title, keep?}."""
        from .crawl import FnCrawlConfirm
        data = request.get_json(silent=True) or {}
        run_id = (data.get("run_id") or "").strip()
        title = (data.get("title") or "").strip()
        keep = data.get("keep")
        if not run_id or not title:
            return jsonify({"ok": False, "error": "run_id and title required"}), 400
        try:
            res = FnCrawlConfirm(run_id, title, keep=keep)
        except Exception as e:
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        if not res.get("ok"):
            return jsonify(res), 400
        return jsonify(res)

    @app.route("/api/concepts/candidates/draft", methods=["GET"])
    def api_candidate_draft():
        """Candidate card draft (read-only): kept staged rows bound to the
        confirmed Vine title. Query: ?repo=&name= ."""
        from .crawl import FnCandidateDraft
        repo = _resolve_repo((request.args.get("repo") or "").strip())
        name = (request.args.get("name") or "").strip()
        if not repo or not name:
            return jsonify({"ok": False, "error": "repo and name required"}), 400
        return jsonify(FnCandidateDraft(repo, name))

    @app.route("/api/concepts/candidates/detach", methods=["POST"])
    def api_candidate_detach():
        """Draft overlay 脫鉤: drop staged rows.
        Body: {repo, name, drop:[{file, mention}]}."""
        from .crawl import FnDetachStaged
        data = request.get_json(silent=True) or {}
        repo = _resolve_repo((data.get("repo") or "").strip())
        name = (data.get("name") or "").strip()
        if not repo or not name:
            return jsonify({"ok": False, "error": "repo and name required"}), 400
        return jsonify(FnDetachStaged(repo, name, data.get("drop")))

    return app
