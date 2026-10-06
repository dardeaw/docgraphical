# -*- coding: utf-8 -*-
"""Document ingest: pptx/docx/pdf -> text -> LLM summary -> md saved next to sources.

Flow (driven by the Explorer dir-node "New document" dialog):
    upload (copied into target dir) -> summarize (LLM preview) ->
    confirm-save (md lands in the SAME dir, header records each source's
    repo-relative path, owning repo incrementally indexed).

Rule (user-mandated): the generated md MUST live next to the uploaded files
AND MUST contain the files' relative paths (repo-relative, so docgraph links
resolve). The header is prepended server-side — never left to the LLM.
"""
import datetime
import os
import re
from typing import Any, Dict, List, Optional

MAX_TEXT_CHARS = 12000  # per-file truncation budget for the LLM prompt
ALLOWED_EXTS = {".pptx", ".ppt", ".docx", ".doc", ".pdf"}
PARSEABLE_EXTS = {".pptx", ".docx", ".pdf"}
# Vision fallback ("open the LLM's eyes"): page/slide images for image-only docs.
VISION_MAX_PAGES = 12   # per file
VISION_MAX_TOTAL = 16   # per summarize call
VISION_MAX_DIM = 1280   # downscale longest edge
VISION_JPEG_Q = 70
VISION_MIN_EDGE = 250   # skip icons/logos smaller than this


def FnSanitizeFilename(name: str) -> str:
    """Unicode-safe basename (unlike werkzeug's ASCII-only secure_filename)."""
    base = os.path.basename((name or "").strip().replace("\\", "/"))
    base = re.sub(r"[\x00-\x1f\x7f]", "", base).strip().strip(".")
    base = re.sub(r'[<>:"|?*\u200b-\u200f]', "_", base)
    return base or "untitled"


def FnIngestDirOk(target_dir: str, roots: List[str]) -> bool:
    """Target must resolve inside one of the search roots (no arbitrary writes)."""
    try:
        t = os.path.abspath(target_dir)
    except Exception:
        return False
    for r in roots or []:
        try:
            a = os.path.abspath(r)
        except Exception:
            continue
        if t == a or t.startswith(a + os.sep):
            return True
    return False


def FnFindOwningRepo(target_dir: str, repos: Dict[str, str]) -> Optional[str]:
    """Longest-prefix match of target_dir against known repo paths."""
    try:
        t = os.path.abspath(target_dir)
    except Exception:
        return None
    best = None
    for _name, p in (repos or {}).items():
        try:
            a = os.path.abspath(p)
        except Exception:
            continue
        if t == a or t.startswith(a + os.sep):
            if best is None or len(a) > len(best):
                best = a
    return best


def FnExtractText(path: str) -> Dict[str, Any]:
    """Extract plain text from pptx/docx/pdf. Old .ppt/.doc binaries rejected."""
    ext = os.path.splitext(path or "")[1].lower()
    if ext not in ALLOWED_EXTS:
        return {"ok": False, "error": "不支援的格式: %s" % ext}
    if ext not in PARSEABLE_EXTS:
        return {"ok": False,
                "error": "舊版二進位格式 (%s) 無法解析，請用 Office 另存為 .pptx/.docx 後再上傳" % ext}
    try:
        if ext == ".pptx":
            from pptx import Presentation
            prs = Presentation(path)
            chunks = []
            for i, slide in enumerate(prs.slides, 1):
                parts = ["[Slide %d]" % i]
                for shape in slide.shapes:
                    if getattr(shape, "has_text_frame", False) and shape.text_frame:
                        t = shape.text.strip()
                        if t:
                            parts.append(t)
                    try:
                        if shape.has_table:
                            for row in shape.table.rows:
                                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                                if cells:
                                    parts.append(" | ".join(cells))
                    except Exception:
                        pass
                if len(parts) > 1:
                    chunks.append("\n".join(parts))
            text = "\n\n".join(chunks)
        elif ext == ".docx":
            import docx
            doc = docx.Document(path)
            chunks = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
            for tb in doc.tables:
                for row in tb.rows:
                    cells = [c.text.strip() for c in row.cells if c.text.strip()]
                    if cells:
                        chunks.append(" | ".join(cells))
            text = "\n".join(chunks)
        else:  # .pdf
            from pypdf import PdfReader
            reader = PdfReader(path)
            chunks = []
            for i, page in enumerate(reader.pages, 1):
                try:
                    t = page.extract_text() or ""
                except Exception:
                    t = ""
                if t.strip():
                    chunks.append("[Page %d]\n%s" % (i, t.strip()))
            text = "\n\n".join(chunks)
    except Exception as e:
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "抽不到文字（可能是掃描圖片型 PDF/ppt）"}
    truncated = len(text) > MAX_TEXT_CHARS
    return {"ok": True, "text": text[:MAX_TEXT_CHARS],
            "chars": len(text), "truncated": truncated}


def FnChatSummarize(text: str, source_names: List[str]) -> Dict[str, Any]:
    """One OpenAI-compatible chat call through the app-wide active LLM."""
    from .llm_provider import FnResolveActiveLLM
    tgt = FnResolveActiveLLM()
    if not tgt.get("ok"):
        return {"ok": False, "error": tgt.get("error") or "no LLM provider configured"}
    import json
    import urllib.request
    names = "、".join(source_names) or "文件"
    prompt = (
        "你是一位技術文件整理助手。請用繁體中文把以下文件內容整理成一份 "
        "Markdown 摘要（開頭一個 # 主標題，## 章節，重點用條列，保留關鍵術語、"
        "數字與專有名詞原文）。\n"
        "來源檔案：%s\n\n===== 文件內容開始 =====\n%s\n===== 文件內容結束 ====="
    ) % (names, text)
    payload = json.dumps({
        "model": tgt["model"],
        "messages": [
            {"role": "system", "content": "你是繁體中文技術文件摘要助手，只輸出 Markdown。"},
            {"role": "user", "content": prompt},
        ],
        # NOTE: no temperature — some models (e.g. gpt-6-luna) only accept
        # the default value 1 and 400 on anything else.
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if tgt.get("key"):
        headers["Authorization"] = "Bearer " + tgt["key"]
    try:
        req = urllib.request.Request(tgt["base"] + "/chat/completions",
                                     data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=180) as res:
            data = json.loads(res.read().decode("utf-8"))
        msg = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        if not msg:
            return {"ok": False, "error": "LLM 回傳為空"}
        return {"ok": True, "summary": msg, "model": tgt["model"], "provider": tgt["provider"]}
    except Exception as e:
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}


def _FnPilToDataUrl(img: Any) -> Optional[str]:
    """Normalize a PIL image (RGB, bounded, JPEG) -> data URL. None if trivial."""
    try:
        from PIL import Image
        import base64
        import io
    except Exception:
        return None
    try:
        if img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            try:
                bg.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
            except Exception:
                bg.paste(img)
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        w, h = img.size
        if min(w, h) < VISION_MIN_EDGE:
            return None
        s = min(1.0, VISION_MAX_DIM / max(w, h))
        if s < 1.0:
            img = img.resize((max(1, int(w * s)), max(1, int(h * s))))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=VISION_JPEG_Q)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


def FnExtractImages(path: str) -> Dict[str, Any]:
    """Render/extract page images for vision fallback.

    pdf  -> pymupdf page renders (covers scans AND odd encodings).
    pptx -> embedded slide pictures (no renderer available server-side).
    Returns {ok, images: [{label, data_url}], note}.
    """
    from PIL import Image
    import io as _io
    ext = os.path.splitext(path or "")[1].lower()
    images: List[Dict[str, str]] = []
    try:
        if ext == ".pdf":
            import fitz
            doc = fitz.open(path)
            n = doc.page_count
            idxs = list(range(n)) if n <= VISION_MAX_PAGES else [
                int(i * n / VISION_MAX_PAGES) for i in range(VISION_MAX_PAGES)]
            for k, i in enumerate(idxs):
                if len(images) >= VISION_MAX_PAGES:
                    break
                page = doc[i]
                pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                url = _FnPilToDataUrl(img)
                if url:
                    images.append({"label": "[Page %d]" % (i + 1), "data_url": url})
            doc.close()
            if n > VISION_MAX_PAGES:
                return {"ok": True, "images": images,
                        "note": "%d 頁僅取 %d 頁辨識" % (n, len(images))}
        elif ext == ".pptx":
            from pptx import Presentation
            prs = Presentation(path)
            for i, slide in enumerate(prs.slides, 1):
                if len(images) >= VISION_MAX_PAGES:
                    break
                for shape in slide.shapes:
                    try:
                        blob = shape.image.blob
                    except Exception:
                        continue
                    try:
                        img = Image.open(_io.BytesIO(blob))
                    except Exception:
                        continue
                    url = _FnPilToDataUrl(img)
                    if url:
                        images.append({"label": "[Slide %d]" % i, "data_url": url})
        else:
            return {"ok": False, "error": "不支援圖片辨識的格式: %s" % ext}
    except Exception as e:
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
    if not images:
        return {"ok": False, "error": "找不到可辨識的頁面圖片（可能是加密或純向量檔）"}
    return {"ok": True, "images": images, "note": ""}


def FnVisionSummarize(images: List[Dict[str, str]],
                      source_names: List[str]) -> Dict[str, Any]:
    """Summarize page/slide images through a vision-capable chat model."""
    from .llm_provider import FnResolveActiveLLM
    tgt = FnResolveActiveLLM()
    if not tgt.get("ok"):
        return {"ok": False, "error": tgt.get("error") or "no LLM provider configured"}
    import json
    import urllib.request
    names = "、".join(source_names) or "文件"
    prompt = (
        "你是一位技術文件整理助手。以下是同一份文件的頁面截圖（按順序），"
        "請用繁體中文看圖整理成一份 Markdown 摘要（開頭一個 # 主標題，"
        "## 章節，重點用條列，保留圖中關鍵術語、數字與專有名詞原文；"
        "看不清楚的地方照實說，不要編造）。\n"
        "來源檔案：%s"
    ) % names
    parts: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
    for im in images:
        parts.append({"type": "image_url",
                      "image_url": {"url": im["data_url"]}})
    payload = json.dumps({
        "model": tgt["model"],
        "messages": [
            {"role": "system", "content": "你是繁體中文技術文件摘要助手，只輸出 Markdown。"},
            {"role": "user", "content": parts},
        ],
        # NOTE: no temperature (see FnChatSummarize) and no max_tokens —
        # quirky proxies 400 on non-standard params.
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if tgt.get("key"):
        headers["Authorization"] = "Bearer " + tgt["key"]
    try:
        req = urllib.request.Request(tgt["base"] + "/chat/completions",
                                     data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=180) as res:
            data = json.loads(res.read().decode("utf-8"))
        msg = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        if not msg:
            return {"ok": False, "error": "LLM 回傳為空"}
        return {"ok": True, "summary": msg, "model": tgt["model"], "provider": tgt["provider"]}
    except Exception as e:
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}


def FnUniqueMdPath(target_dir: str, filename: str) -> str:
    """Collision-safe md path inside target_dir (adds -2, -3, ...)."""
    name = FnSanitizeFilename(filename)
    if not name.lower().endswith(".md"):
        name += ".md"
    cand = os.path.join(target_dir, name)
    if not os.path.exists(cand):
        return cand
    stem = name[:-3]
    i = 2
    while True:
        cand = os.path.join(target_dir, "%s-%d.md" % (stem, i))
        if not os.path.exists(cand):
            return cand
        i += 1


def FnBuildMd(title: str, source_rels: List[str], summary: str,
              model: str = "") -> str:
    """Assemble the final md. Source relative paths are ALWAYS in the header."""
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = ["# %s" % (title or "文件摘要"), ""]
    lines.append("> 來源檔案（相對路徑）：")
    for r in source_rels:
        lines.append("> - `%s`" % r)
    lines.append(">")
    lines.append("> 匯入時間：%s%s" % (stamp, ("　生成模型：%s" % model) if model else ""))
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append((summary or "").strip())
    lines.append("")
    return "\n".join(lines)