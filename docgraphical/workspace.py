"""Workspace manager for DocGraphical.

Supports multi-workspace management with named configuration profiles,
seamless migration from legacy single-config files, and in-place rename / switch.
"""

import os
import sys
import json
import re
from typing import Dict, List, Optional, Any
from . import constants

WORKSPACES_ROOT = os.path.expanduser(os.environ.get("DOCGRAPHICAL_WORKSPACES_DIR") or "~/.docgraphical/workspaces")
MANIFEST_FILE = os.path.expanduser(os.environ.get("DOCGRAPHICAL_WORKSPACES_MANIFEST") or "~/.docgraphical/workspaces.json")
DEFAULT_WORKSPACE_ID = "default"


def _ensure_dir(path: str) -> None:
    if not os.path.exists(path):
        try:
            os.makedirs(path, exist_ok=True)
        except OSError:
            pass


def _sanitize_id(name: str) -> str:
    cleaned = re.sub(r"[^\w\-\.]", "_", name.strip())
    return cleaned.strip("_") or "workspace"


def get_manifest() -> Dict[str, Any]:
    """Load workspaces manifest."""
    _ensure_dir(os.path.dirname(MANIFEST_FILE))
    _ensure_dir(WORKSPACES_ROOT)

    manifest: Dict[str, Any] = {
        "active": DEFAULT_WORKSPACE_ID,
        "workspaces": []
    }
    if os.path.exists(MANIFEST_FILE):
        try:
            with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            pass

    # Ensure default workspace exists in manifest
    ws_ids = [w.get("id") for w in manifest.get("workspaces", []) if isinstance(w, dict)]
    if DEFAULT_WORKSPACE_ID not in ws_ids:
        default_item = {
            "id": DEFAULT_WORKSPACE_ID,
            "name": "預設工作區",
            "name_en": "Default Workspace",
            "name_ja": "デフォルトワークスペース",
            "icon": "🏢"
        }
        manifest.setdefault("workspaces", []).insert(0, default_item)
        save_manifest(manifest)

    if not manifest.get("active") or manifest["active"] not in [w["id"] for w in manifest["workspaces"]]:
        manifest["active"] = DEFAULT_WORKSPACE_ID
        save_manifest(manifest)

    return manifest


def save_manifest(manifest: Dict[str, Any]) -> None:
    """Save workspaces manifest."""
    _ensure_dir(os.path.dirname(MANIFEST_FILE))
    try:
        with open(MANIFEST_FILE, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Failed to save workspaces manifest: {e}", file=sys.stderr)


def get_active_workspace_id() -> str:
    # Explicit env override takes highest precedence (CLI --workspace or isolated mode)
    env_ws = os.environ.get("DOCGRAPHICAL_ACTIVE_WORKSPACE")
    if env_ws:
        return env_ws
    manifest = get_manifest()
    return manifest.get("active") or DEFAULT_WORKSPACE_ID


def get_workspace_config_path(ws_id: Optional[str] = None) -> str:
    target_id = ws_id or get_active_workspace_id()
    _ensure_dir(WORKSPACES_ROOT)
    return os.path.join(WORKSPACES_ROOT, f"{target_id}.json")


def load_workspace_config(ws_id: Optional[str] = None) -> Dict[str, List[str]]:
    target_id = ws_id or get_active_workspace_id()
    ws_file = get_workspace_config_path(target_id)

    roots: List[str] = []
    excluded: List[str] = []

    if os.path.exists(ws_file):
        try:
            with open(ws_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                roots = data.get("custom_roots") or []
                excluded = data.get("excluded_paths") or []
                return {"custom_roots": roots, "excluded_paths": excluded}
        except Exception:
            pass

    # Seamless Migration: If default workspace file does not exist yet,
    # inherit from legacy ~/.docgraphical_config.json
    if target_id == DEFAULT_WORKSPACE_ID:
        legacy_cfg = os.path.expanduser("~/.docgraphical_config.json")
        if os.path.exists(legacy_cfg):
            try:
                with open(legacy_cfg, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    roots = data.get("custom_roots") or []
                    excluded = data.get("excluded_paths") or []
            except Exception:
                pass

        # Fallback to standard OneDrive PythonCode folder if still empty
        if not roots and not os.environ.get("DOCGRAPHICAL_CONFIG"):
            for sr in [
                os.path.abspath(r"D:\OneDrive - 勤誠興業股份有限公司\文件\PythonCode"),
                os.path.abspath(r"C:\OneDrive - 勤誠興業股份有限公司\文件\PythonCode"),
            ]:
                if os.path.exists(sr) and sr not in roots:
                    roots.append(sr)

        cfg = {"custom_roots": roots, "excluded_paths": excluded}
        save_workspace_config(cfg, ws_id=DEFAULT_WORKSPACE_ID)
        return cfg

    return {"custom_roots": roots, "excluded_paths": excluded}


def save_workspace_config(cfg: Dict[str, List[str]], ws_id: Optional[str] = None) -> None:
    target_id = ws_id or get_active_workspace_id()
    ws_file = get_workspace_config_path(target_id)
    _ensure_dir(os.path.dirname(ws_file))
    try:
        with open(ws_file, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Failed to save workspace config ({target_id}): {e}", file=sys.stderr)


def list_workspaces() -> List[Dict[str, Any]]:
    manifest = get_manifest()
    active_id = get_active_workspace_id()
    result = []
    for item in manifest.get("workspaces", []):
        w_id = item.get("id")
        cfg = load_workspace_config(w_id)
        roots_count = len(cfg.get("custom_roots", []))
        result.append({
            "id": w_id,
            "name": item.get("name") or w_id,
            "name_en": item.get("name_en") or item.get("name") or w_id,
            "name_ja": item.get("name_ja") or item.get("name") or w_id,
            "icon": item.get("icon") or "🏢",
            "is_active": (w_id == active_id),
            "roots_count": roots_count
        })
    return result


def switch_workspace(ws_id: str) -> Dict[str, Any]:
    manifest = get_manifest()
    ws_ids = [w.get("id") for w in manifest.get("workspaces", [])]
    if ws_id not in ws_ids:
        return {"success": False, "error": f"Workspace '{ws_id}' not found"}

    manifest["active"] = ws_id
    save_manifest(manifest)
    os.environ["DOCGRAPHICAL_ACTIVE_WORKSPACE"] = ws_id
    return {"success": True, "active": ws_id}


def create_workspace(name: str, copy_from: Optional[str] = None) -> Dict[str, Any]:
    name = (name or "").strip()
    if not name:
        return {"success": False, "error": "Workspace name cannot be empty"}

    manifest = get_manifest()
    ws_ids = [w.get("id") for w in manifest.get("workspaces", [])]

    # Generate unique ID
    base_id = _sanitize_id(name)
    cand_id = base_id
    counter = 1
    while cand_id in ws_ids:
        cand_id = f"{base_id}_{counter}"
        counter += 1

    new_item = {
        "id": cand_id,
        "name": name,
        "name_en": name,
        "name_ja": name,
        "icon": "📁"
    }

    initial_cfg = {"custom_roots": [], "excluded_paths": []}
    if copy_from and copy_from in ws_ids:
        initial_cfg = load_workspace_config(copy_from)

    save_workspace_config(initial_cfg, ws_id=cand_id)
    manifest.get("workspaces", []).append(new_item)
    save_manifest(manifest)

    return {"success": True, "workspace": new_item}


def rename_workspace(ws_id: str, new_name: str) -> Dict[str, Any]:
    new_name = (new_name or "").strip()
    if not new_name:
        return {"success": False, "error": "Workspace name cannot be empty"}

    manifest = get_manifest()
    found = False
    for item in manifest.get("workspaces", []):
        if item.get("id") == ws_id:
            item["name"] = new_name
            item["name_en"] = new_name
            item["name_ja"] = new_name
            found = True
            break

    if not found:
        return {"success": False, "error": f"Workspace '{ws_id}' not found"}

    save_manifest(manifest)
    return {"success": True, "id": ws_id, "name": new_name}


def delete_workspace(ws_id: str) -> Dict[str, Any]:
    if ws_id == DEFAULT_WORKSPACE_ID:
        return {"success": False, "error": "Cannot delete default workspace"}

    manifest = get_manifest()
    ws_list = manifest.get("workspaces", [])
    target = next((w for w in ws_list if w.get("id") == ws_id), None)
    if not target:
        return {"success": False, "error": f"Workspace '{ws_id}' not found"}

    manifest["workspaces"] = [w for w in ws_list if w.get("id") != ws_id]
    if manifest.get("active") == ws_id:
        manifest["active"] = DEFAULT_WORKSPACE_ID
        os.environ["DOCGRAPHICAL_ACTIVE_WORKSPACE"] = DEFAULT_WORKSPACE_ID

    save_manifest(manifest)

    # Delete config file
    cfg_path = get_workspace_config_path(ws_id)
    if os.path.exists(cfg_path):
        try:
            os.remove(cfg_path)
        except OSError:
            pass

    return {"success": True, "active": manifest["active"]}
