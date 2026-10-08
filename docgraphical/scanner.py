"""Documentation discovery and filesystem tree scanning."""
import os
import re
from typing import Dict, List, Any, Optional
from .constants import IGNORE_DIRS, DOC_EXTS, SOURCE_EXTS
from .config import load_config
from .parser import parse_headings

_MD_SRC_RE = re.compile(r"^> - `(.+)`$", re.M)


def is_doc_file(filename: str) -> bool:
    return filename.lower().endswith(DOC_EXTS)


def scan_doc_repositories(search_roots: List[str]) -> Dict[str, str]:
    """Discover all folders containing markdown documents under search roots."""
    cfg = load_config()
    excluded = [os.path.abspath(p) for p in cfg.get("excluded_paths", [])]

    repos: Dict[str, str] = {}

    for root_dir in search_roots:
        if not os.path.isdir(root_dir):
            continue
        abs_root = os.path.abspath(root_dir)
        if abs_root in excluded:
            continue

        # Add root itself
        repos[os.path.basename(abs_root) or abs_root] = abs_root

        # Scan 2 levels down for project folders
        try:
            for entry in os.scandir(abs_root):
                if entry.is_dir() and entry.name not in IGNORE_DIRS and not entry.name.startswith("."):
                    sub_path = os.path.abspath(entry.path)
                    if sub_path not in excluded:
                        # Check if has any markdown files
                        has_md = False
                        try:
                            for sub_entry in os.scandir(sub_path):
                                if sub_entry.is_file() and is_doc_file(sub_entry.name):
                                    has_md = True
                                    break
                        except Exception:
                            pass
                        if has_md:
                            repos[entry.name] = sub_path
        except Exception:
            pass

    return repos


def get_dir_file_tree(repo_path: str) -> Dict[str, Any]:
    """Generate recursive folder and markdown file tree."""
    repo_path = os.path.abspath(repo_path)
    if not os.path.exists(repo_path):
        return {"name": os.path.basename(repo_path), "path": repo_path, "type": "dir", "children": []}

    def build_tree(current_path: str) -> Dict[str, Any]:
        node: Dict[str, Any] = {
            "name": os.path.basename(current_path) or current_path,
            "path": current_path,
            "type": "dir",
            "children": []
        }
        try:
            entries = sorted(os.scandir(current_path), key=lambda e: (not e.is_dir(), e.name.lower()))
            for e in entries:
                if e.name.startswith(".") or e.name in IGNORE_DIRS:
                    continue
                if e.is_dir():
                    child_tree = build_tree(e.path)
                    # Only include dirs that contain markdown or subdirs
                    if child_tree["children"]:
                        node["children"].append(child_tree)
                elif e.is_file() and is_doc_file(e.name):
                    try:
                        headings = parse_headings(e.path)
                        h_count = len(headings)
                    except Exception:
                        h_count = 0
                    node["children"].append({
                        "name": e.name,
                        "path": e.path,
                        "type": "file",
                        "headings": h_count,
                        "size": e.stat().st_size
                    })
        except Exception:
            pass
        return node

    return build_tree(repo_path)


def get_repo_doc_metrics(repo_path: str,
                         indexed_set: Optional[set] = None) -> Dict[str, Any]:
    """Compute markdown file count and heading metrics for a repository.

    indexed_set: relative paths currently present in this repo's SQLite index.
        When provided (repo IS indexed), files on disk that are NOT yet in the
        index are reported as pending_files (capped) + pending_count so the
        UI can show an honest "Re-index / N pending" state instead of a
        blind "Index" button. None => repo has no index => no pending report.
    """
    md_files = 0
    total_headings = 0
    total_size = 0
    vPending: List[str] = []
    pending_count = 0
    vUnindexed: List[str] = []
    unindexed_count = 0
    vDirs: List[str] = []
    vSources: List[str] = []
    source_count = 0
    vMdSources: Dict[str, List[str]] = {}
    repo_real = os.path.realpath(repo_path)
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]
        rel_root = os.path.relpath(root, repo_path).replace("\\", "/")
        if rel_root != "." and len(vDirs) < 500:
            vDirs.append(rel_root)
        for f in files:
            low = f.lower()
            if low.endswith(SOURCE_EXTS):
                # Ingest source file (ppt/pdf/word): listed for the
                # Explorer "Show source" toggle (capped like pending).
                source_count += 1
                if len(vSources) < 300:
                    vSources.append(os.path.relpath(
                        os.path.join(root, f), repo_path).replace("\\", "/"))
            if f.upper() == "LOG.MD" and os.path.abspath(root) == os.path.abspath(repo_path):
                continue
            if is_doc_file(f):
                md_files += 1
                full = os.path.join(root, f)
                rel = os.path.relpath(full, repo_path).replace("\\", "/")
                if indexed_set is not None:
                    if rel not in indexed_set:
                        pending_count += 1
                        if len(vPending) < 300:
                            vPending.append(rel)
                else:
                    # No DB yet: every disk file is unindexed (galaxy-style
                    # tree needs the real file list, capped like pending).
                    unindexed_count += 1
                    if len(vUnindexed) < 300:
                        vUnindexed.append(rel)
                try:
                    total_size += os.path.getsize(full)
                    h = parse_headings(full)
                    total_headings += len(h)
                except Exception:
                    pass
                # Header-recorded sources: `> - `rel`` lines resolve against
                # this repo; only existing on-disk files are reported, so the
                # tree can hang each source directly under its md. Orphans
                # (recorded nowhere) are never shown.
                try:
                    if len(vMdSources) < 300:
                        with open(full, "r", encoding="utf-8", errors="replace") as _hf:
                            _head = _hf.read(4096)
                        _ok: List[str] = []
                        for _m in _MD_SRC_RE.findall(_head):
                            _r = (_m or "").strip()
                            if not _r or ".." in _r.split("/"):
                                continue
                            _sp = os.path.realpath(os.path.join(repo_real, _r.replace("/", os.sep)))
                            if _sp.startswith(repo_real + os.sep) and os.path.isfile(_sp):
                                _rr = os.path.relpath(_sp, repo_path).replace("\\", "/")
                                if _rr not in _ok:
                                    _ok.append(_rr)
                        if _ok:
                            vMdSources[rel] = _ok
                except Exception:
                    pass
    return {
        "files": md_files,
        "headings": total_headings,
        "size": total_size,
        "pending_files": vPending if indexed_set is not None else [],
        "pending_count": pending_count if indexed_set is not None else 0,
        "unindexed_files": vUnindexed if indexed_set is None else [],
        "unindexed_count": unindexed_count if indexed_set is None else 0,
        # All on-disk dirs (rel paths): lets the tree render EMPTY folders
        # (e.g. freshly created via New Folder) that no file entry implies.
        "all_dirs": vDirs,
        # Ingest source files (ppt/pdf/word rel paths) for the Explorer
        # "Show source" toggle.
        "source_files": vSources,
        "source_count": source_count,
        # md rel -> header-recorded source rels (existing files only):
        # the tree hangs each source directly under its md.
        "md_sources": vMdSources,
    }

