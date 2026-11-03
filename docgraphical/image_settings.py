"""Image Ingest and attachment filtering settings for DocGraphical.

Provides customizable geometric, color variance, and edge entropy filters
to surgically extract meaningful diagrams, photos, and figures from
PDF, PPTX, and DOCX documents while dropping decorative lines, icons, and solid blocks.

Storage:
- File: ~/.docgraphical/image_settings.json
"""

import json
import os
import math
from typing import Any, Dict, Optional, Tuple

DEFAULT_IMAGE_SETTINGS: Dict[str, Any] = {
    "min_width": 200,          # Minimum width in pixels
    "min_height": 200,         # Minimum height in pixels
    "max_aspect_ratio": 10.0,  # Max aspect ratio (e.g. 10.0 means range [0.1, 10.0])
    "min_std_dev": 15.0,       # Minimum grayscale standard deviation (filters solid backgrounds)
    "max_single_color": 0.95,  # Maximum single-color proportion (0.95 = 95%)
    "min_edge_intensity": 3.0, # Minimum Laplacian edge intensity
    "deduplicate": True        # Filter identical images (MD5 content hash)
}


def _FnConfigPath() -> str:
    env_override = os.environ.get("DOCGRAPH_IMAGE_SETTINGS_FILE")
    if env_override:
        return env_override
    try:
        from . import workspace
        ws_path = workspace.get_workspace_file_path("image_settings.json")
        # Seamless inheritance: if workspace file doesn't exist yet, check global
        if not os.path.exists(ws_path):
            global_path = os.path.join(os.path.expanduser("~"), ".docgraphical", "image_settings.json")
            if os.path.exists(global_path):
                try:
                    import shutil
                    os.makedirs(os.path.dirname(ws_path), exist_ok=True)
                    shutil.copy2(global_path, ws_path)
                except Exception:
                    return global_path
        return ws_path
    except Exception:
        return os.path.join(os.path.expanduser("~"), ".docgraphical", "image_settings.json")


def FnGetImageSettings() -> Dict[str, Any]:
    """Load image ingest settings, falling back to built-in defaults."""
    cfg = dict(DEFAULT_IMAGE_SETTINGS)
    path = _FnConfigPath()
    try:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                for k in DEFAULT_IMAGE_SETTINGS:
                    if k in data:
                        cfg[k] = data[k]
    except Exception:
        pass
    return cfg


def FnSaveImageSettings(new_settings: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and persist image ingest settings."""
    cfg = FnGetImageSettings()
    if not isinstance(new_settings, dict):
        return cfg

    # Validate min_width & min_height
    if "min_width" in new_settings:
        try:
            cfg["min_width"] = max(20, int(new_settings["min_width"]))
        except Exception:
            pass
    if "min_height" in new_settings:
        try:
            cfg["min_height"] = max(20, int(new_settings["min_height"]))
        except Exception:
            pass

    # Validate max_aspect_ratio (must be >= 1.0)
    if "max_aspect_ratio" in new_settings:
        try:
            r = float(new_settings["max_aspect_ratio"])
            if r < 1.0:
                r = 1.0 / r if r > 0 else 10.0
            cfg["max_aspect_ratio"] = min(50.0, max(1.2, r))
        except Exception:
            pass

    # Validate min_std_dev
    if "min_std_dev" in new_settings:
        try:
            cfg["min_std_dev"] = max(0.0, float(new_settings["min_std_dev"]))
        except Exception:
            pass

    # Validate max_single_color (0.5 ~ 1.0)
    if "max_single_color" in new_settings:
        try:
            val = float(new_settings["max_single_color"])
            if val > 1.0 and val <= 100.0:  # e.g. 95 -> 0.95
                val = val / 100.0
            cfg["max_single_color"] = min(1.0, max(0.5, val))
        except Exception:
            pass

    # Validate min_edge_intensity
    if "min_edge_intensity" in new_settings:
        try:
            cfg["min_edge_intensity"] = max(0.0, float(new_settings["min_edge_intensity"]))
        except Exception:
            pass

    # Validate deduplicate
    if "deduplicate" in new_settings:
        cfg["deduplicate"] = bool(new_settings["deduplicate"])

    path = _FnConfigPath()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    return cfg


def FnResetImageSettings() -> Dict[str, Any]:
    """Restore image settings to factory defaults."""
    cfg = dict(DEFAULT_IMAGE_SETTINGS)
    path = _FnConfigPath()
    try:
        if os.path.isfile(path):
            os.remove(path)
    except Exception:
        pass
    return cfg


def FnIsSignificantImage(pil_img: Any, cfg: Optional[Dict[str, Any]] = None, seen_hashes: Optional[set] = None) -> Tuple[bool, str]:
    """Evaluate whether an image is significant using CPU-based heuristics.
    
    Returns (is_significant: bool, reason: str).
    """
    if cfg is None:
        cfg = FnGetImageSettings()

    try:
        w, h = pil_img.size
        # 1. Minimum Width & Height
        if w < cfg.get("min_width", 200) or h < cfg.get("min_height", 200):
            return False, f"尺寸過小 ({w}x{h} < {cfg.get('min_width')}x{cfg.get('min_height')})"

        # 2. Aspect Ratio (reciprocal check: ratio > max or ratio < 1/max)
        max_ratio = float(cfg.get("max_aspect_ratio", 10.0))
        min_ratio = 1.0 / max_ratio if max_ratio > 0 else 0.1
        ratio = float(w) / float(h)
        if ratio > max_ratio or ratio < min_ratio:
            return False, f"長寬比過於狹長 ({ratio:.2f} 不在 [{min_ratio:.2f}, {max_ratio:.2f}] 區間)"

        # 3. Deduplication check
        if cfg.get("deduplicate", True) and seen_hashes is not None:
            import hashlib
            # Use raw bytes or downscaled thumbnail for hash
            img_bytes = pil_img.tobytes()
            hsh = hashlib.md5(img_bytes).hexdigest()
            if hsh in seen_hashes:
                return False, "重複圖片或重複母片商標"
            seen_hashes.add(hsh)

        # 4. Color variance / Standard Deviation check
        # Convert to grayscale
        gray_img = pil_img.convert("L")
        stat = gray_img.histogram()
        # Compute mean and standard deviation from 256-bin histogram
        total_pixels = float(w * h)
        if total_pixels <= 0:
            return False, "無像素"

        mean = sum(i * count for i, count in enumerate(stat)) / total_pixels
        variance = sum(count * ((i - mean) ** 2) for i, count in enumerate(stat)) / total_pixels
        std_dev = math.sqrt(max(0.0, variance))

        if std_dev < cfg.get("min_std_dev", 15.0):
            return False, f"灰階標準差過低 ({std_dev:.1f} < {cfg.get('min_std_dev')})，色彩單調純色"

        # 5. Dominant color proportion
        max_single_color_ratio = float(cfg.get("max_single_color", 0.95))
        max_color_count = max(stat)
        if (max_color_count / total_pixels) > max_single_color_ratio:
            return False, f"單一主色佔比過高 ({(max_color_count / total_pixels):.2%} > {max_single_color_ratio:.0%})，純底或近空圖"

        # 6. Edge intensity check
        min_edge = float(cfg.get("min_edge_intensity", 3.0))
        if min_edge > 0:
            from PIL import ImageFilter
            edges = gray_img.filter(ImageFilter.FIND_EDGES)
            edge_stat = edges.histogram()
            edge_mean = sum(i * count for i, count in enumerate(edge_stat)) / total_pixels
            if edge_mean < min_edge:
                return False, f"邊緣資訊強度不足 ({edge_mean:.2f} < {min_edge})，無足夠輪廓線條"

        return True, "通過篩選"
    except Exception as e:
        # Fallback to permissive on error
        return True, f"判定例外容錯通過: {e}"
