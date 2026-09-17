import os
import sys
import json
from typing import Dict, List, Optional
from .constants import CONFIG_FILE


def get_default_repo_root() -> str:
    """Return default repository root."""
    return os.getcwd()


def get_docgraph_dir(repo_path: Optional[str] = None) -> str:
    """Return .docgraphical or .docgraph directory path."""
    base = repo_path or get_default_repo_root()
    docgraphical_dir = os.path.join(base, ".docgraphical")
    docgraph_dir = os.path.join(base, ".docgraph")
    if os.path.exists(docgraphical_dir):
        return docgraphical_dir
    if os.path.exists(docgraph_dir):
        return docgraph_dir
    return docgraphical_dir


def get_default_db_path(repo_path: Optional[str] = None) -> str:
    """Return SQLite database path, checking both .docgraphical and .docgraph."""
    base = repo_path or get_default_repo_root()
    for candidate in [
        os.path.join(base, ".docgraphical", "docgraphical.db"),
        os.path.join(base, ".docgraph", "docgraph.db"),
        os.path.join(base, ".docgraphical", "docgraph.db"),
        os.path.join(base, ".docgraph", "docgraphical.db"),
    ]:
        if os.path.exists(candidate):
            return candidate
    return os.path.join(base, ".docgraphical", "docgraphical.db")


def load_config() -> Dict[str, List[str]]:
    """Load configuration, seamlessly migrating from legacy config if needed."""
    legacy_cfg_path = os.path.expanduser("~/.docgraph_config.json")
    
    roots: List[str] = []
    excluded: List[str] = []

    # 1. Try modern config file
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                roots = data.get("custom_roots") or []
                excluded = data.get("excluded_paths") or []
        except Exception:
            pass

    # 2. If modern config has no roots, check legacy config
    if not roots and os.path.exists(legacy_cfg_path):
        try:
            with open(legacy_cfg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                roots = data.get("custom_roots") or []
                if not excluded:
                    excluded = data.get("excluded_paths") or []
                # Save migrated config
                save_config({"custom_roots": roots, "excluded_paths": excluded})
        except Exception:
            pass

    # 3. If still empty, check standard OneDrive PythonCode folder
    if not roots:
        standard_roots = [
            os.path.abspath(r"D:\OneDrive - 勤誠興業股份有限公司\文件\PythonCode"),
            os.path.abspath(r"C:\OneDrive - 勤誠興業股份有限公司\文件\PythonCode"),
        ]
        for sr in standard_roots:
            if os.path.exists(sr) and sr not in roots:
                roots.append(sr)
        if roots:
            save_config({"custom_roots": roots, "excluded_paths": excluded})

    return {"custom_roots": roots, "excluded_paths": excluded}


def save_config(cfg: Dict[str, List[str]]) -> None:
    """Save configuration to user home directory."""
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Failed to save docgraphical config: {e}", file=sys.stderr)


def get_search_roots(extra_paths: Optional[List[str]] = None) -> List[str]:
    """Resolve and deduplicate all documentation search roots."""
    roots: List[str] = []
    if extra_paths:
        for p in extra_paths:
            abs_p = os.path.abspath(p)
            if abs_p not in roots and os.path.exists(abs_p):
                roots.append(abs_p)

    cfg = load_config()
    for p in cfg.get("custom_roots", []):
        abs_p = os.path.abspath(p)
        if abs_p not in roots and os.path.exists(abs_p):
            roots.append(abs_p)

    # If empty, default to current working directory
    if not roots:
        roots.append(os.path.abspath(os.getcwd()))

    return roots
