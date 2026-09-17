"""Documentation discovery and filesystem tree scanning."""
import os
from typing import Dict, List, Any, Optional
from .constants import IGNORE_DIRS, DOC_EXTS
from .config import load_config
from .parser import parse_headings

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

def get_repo_doc_metrics(repo_path: str) -> Dict[str, Any]:
    """Compute markdown file count and heading metrics for a repository."""
    md_files = 0
    total_headings = 0
    total_size = 0
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]
        for f in files:
            if is_doc_file(f):
                md_files += 1
                full = os.path.join(root, f)
                try:
                    total_size += os.path.getsize(full)
                    h = parse_headings(full)
                    total_headings += len(h)
                except Exception:
                    pass
    return {
        "files": md_files,
        "headings": total_headings,
        "size": total_size
    }
