import os
import sys
import json
from typing import Dict, List, Optional
from . import constants


def _get_config_file() -> str:
    return os.environ.get("DOCGRAPHICAL_CONFIG") or getattr(constants, "CONFIG_FILE", None) or os.path.expanduser("~/.docgraphical_config.json")


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
    """Load configuration.
    
    If DOCGRAPHICAL_CONFIG environment variable is explicitly set (e.g. isolated test mode),
    read directly from that file. Otherwise, delegate to the active Workspace config.
    """
    if os.environ.get("DOCGRAPHICAL_CONFIG"):
        cfg_file = _get_config_file()
        roots: List[str] = []
        excluded: List[str] = []
        if os.path.exists(cfg_file):
            try:
                with open(cfg_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    roots = data.get("custom_roots") or []
                    excluded = data.get("excluded_paths") or []
            except Exception:
                pass
        return {"custom_roots": roots, "excluded_paths": excluded}

    from . import workspace
    return workspace.load_workspace_config()


def save_config(cfg: Dict[str, List[str]]) -> None:
    """Save configuration."""
    if os.environ.get("DOCGRAPHICAL_CONFIG"):
        try:
            with open(_get_config_file(), "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Failed to save docgraphical config: {e}", file=sys.stderr)
        return

    from . import workspace
    workspace.save_workspace_config(cfg)


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

    isolated = bool(os.environ.get("DOCGRAPHICAL_CONFIG"))
    # If empty and NOT isolated, default to current working directory
    if not roots and not isolated:
        roots.append(os.path.abspath(os.getcwd()))

    return roots
