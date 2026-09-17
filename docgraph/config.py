"""Configuration and directory search roots management for DocGraph."""
import os
import sys
import json
from typing import Dict, List, Optional
from .constants import CONFIG_FILE

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
