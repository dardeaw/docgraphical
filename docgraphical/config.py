import os
import sys
import json
from typing import Dict, List, Optional
from .constants import CONFIG_FILE


def get_default_repo_root() -> str:
    """Return default repository root."""
    return os.getcwd()


def get_docgraph_dir(repo_path: Optional[str] = None) -> str:
    """Return .docgraphical directory path."""
    base = repo_path or get_default_repo_root()
    return os.path.join(base, ".docgraphical")


def get_default_db_path(repo_path: Optional[str] = None) -> str:
    """Return default SQLite database path."""
    return os.path.join(get_docgraph_dir(repo_path), "docgraphical.db")


def load_config() -> Dict[str, List[str]]:
    """Load configuration from user home directory."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                roots = data.get("custom_roots") or []
                excluded = data.get("excluded_paths") or []
                return {"custom_roots": roots, "excluded_paths": excluded}
        except Exception:
            pass
    return {"custom_roots": [], "excluded_paths": []}


def save_config(cfg: Dict[str, List[str]]) -> None:
    """Save configuration to user home directory."""
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Failed to save docgraph config: {e}", file=sys.stderr)


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
