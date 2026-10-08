"""DocGraphical app-wide LLM provider management (rooted in codegraph-galaxy's chat_provider.py).

IMPORTANT: unlike galaxy (chat-panel-only), this module is the single LLM
infrastructure for the WHOLE APP — ingest summaries, the future chat backend,
and any other feature that burns tokens all resolve their endpoint through
FnResolveActiveLLM(). Nothing in the app should read LLM env vars directly.

Provider CRUD, connectivity tests and remote model auto-fill for the settings
dialog. Stdlib-only HTTP (urllib). Auto-fill probes /models first, then
/api/tags as a generic fallback.

State precedence for "active LLM":
    1. persisted current  -> ~/.docgraphical/llm.json  ("current" field)
    2. env fallback       -> DOCGRAPH_LLM_PROVIDER / DOCGRAPH_LLM_MODEL
The current selection is persisted SERVER-SIDE so background jobs (ingest)
resolve the same provider with no browser session in the picture.

NOTE: there is NO built-in Ollama provider anymore (nobody uses Ollama here).
Every provider — including local endpoints — is added by the user through the
settings dialog and lives in the providers file.

Env switches (all optional):
    DOCGRAPH_LLM_PROVIDER       fallback provider id
    DOCGRAPH_LLM_MODEL          fallback model id
    DOCGRAPH_LLM_BASE           env custom OpenAI-compatible base
    DOCGRAPH_LLM_KEY            env custom API key
    DOCGRAPH_LLM_CUSTOM_MODEL   env custom model id (comma separated allowed)
    DOCGRAPH_LLM_FILE           override providers file path
"""
import json
import os
import re
import urllib.request
from typing import Any, Dict, List, Optional

LLM_PROVIDER = os.environ.get("DOCGRAPH_LLM_PROVIDER", "").strip().lower()
LLM_MODEL = os.environ.get("DOCGRAPH_LLM_MODEL", "").strip()
CUSTOM_BASE = os.environ.get("DOCGRAPH_LLM_BASE", "").rstrip("/")
CUSTOM_KEY = os.environ.get("DOCGRAPH_LLM_KEY", "")
CUSTOM_MODEL = os.environ.get("DOCGRAPH_LLM_CUSTOM_MODEL", "")


# ---------------------------------------------------------------- state ----
def FnGetActiveLLM() -> Dict[str, Any]:
    """Active provider/model ids: persisted current first, env fallback second."""
    dicCur = _FnLoadFileProviders().get("current") or {}
    strProvider = (dicCur.get("provider") or "").strip() or LLM_PROVIDER
    strModel = (dicCur.get("model") or "").strip() or LLM_MODEL
    return {"provider": strProvider, "model": strModel}


def FnSetActiveLLM(str_provider: str, str_model: str) -> Dict[str, Any]:
    """Persist the app-wide active provider/model to the config file (server truth)."""
    dicData = _FnLoadFileProviders()
    dicData["current"] = {"provider": str(str_provider or "").strip().lower(),
                          "model": str(str_model or "").strip()}
    _FnSaveFileProviders(dicData)
    return FnGetActiveLLM()


def FnResolveActiveLLM() -> Dict[str, Any]:
    """Resolve the active LLM into a directly-usable target.

    Returns {provider, model, base, key, proto, ok} for any module that needs
    to call the LLM (ingest summary, chat, ...). proto is "openai" (generic
    OpenAI-compatible /models endpoint).
    Falls back gracefully: missing provider id -> first file provider ->
    env custom. If nothing is configured, ok=False (there is no built-in
    Ollama fallback anymore — the user must add a provider first).
    key is UNMASKED here (backend consumers need it).
    """
    dicCur = FnGetActiveLLM()
    strId = (dicCur.get("provider") or "").strip().lower()
    strModel = (dicCur.get("model") or "").strip()
    dicP = _FnFindProviderEntry(strId)
    if not dicP:
        vF = _FnLoadFileProviders().get("providers") or []
        if vF:
            dicP = {**vF[0], "proto": "openai"}
        elif CUSTOM_BASE:
            dicP = {"id": "custom", "label": "env custom", "base": CUSTOM_BASE,
                    "key": CUSTOM_KEY, "proto": "openai"}
        else:
            return {"ok": False, "provider": strId, "model": strModel,
                    "base": "", "key": "", "proto": "openai",
                    "error": "no LLM provider configured"}
        strId = dicP.get("id", "")
    if not strModel:
        strModel = (dicP.get("models") or [""])[0]
    return {"ok": True,
            "provider": dicP.get("id", strId),
            "model": strModel,
            "base": (dicP.get("base") or "").rstrip("/"),
            "key": dicP.get("key") or "",
            "proto": dicP.get("proto", "openai")}


# ------------------------------------------------------------- listing ----
def FnListProviders() -> Dict[str, Any]:
    """env custom + file providers (no built-in Ollama — removed on purpose)."""
    vProviders: List[Dict[str, Any]] = []
    if CUSTOM_BASE:
        vModels = [m.strip() for m in CUSTOM_MODEL.split(",") if m.strip()] or ["default"]
        vProviders.append({"id": "custom", "label": f"Custom OpenAI-compatible ({CUSTOM_BASE})",
                           "models": vModels, "available": True, "source": "env",
                           "base": CUSTOM_BASE})
    for dicP in _FnLoadFileProviders().get("providers", []):
        vProviders.append({**dicP, "source": "file", "available": True,
                           "key": "***" if dicP.get("key") else ""})
    return {"providers": vProviders, "current": FnGetActiveLLM()}


# --------------------------------------------------------------- files ----
def _FnConfigPath() -> str:
    return os.environ.get("DOCGRAPH_LLM_FILE") or os.path.join(
        os.path.expanduser("~"), ".docgraphical", "llm.json")


def _FnLoadFileProviders() -> Dict[str, Any]:
    try:
        with open(_FnConfigPath(), "r", encoding="utf-8") as f:
            dicData = json.load(f)
        if isinstance(dicData, dict):
            vP = dicData.get("providers") or []
            return {"providers": [p for p in vP if isinstance(p, dict) and p.get("id")],
                    "current": dicData.get("current") or {}}
    except Exception:
        pass
    return {"providers": [], "current": {}}


def _FnSaveFileProviders(dicData: Dict[str, Any]) -> None:
    strPath = _FnConfigPath()
    os.makedirs(os.path.dirname(strPath), exist_ok=True)
    with open(strPath, "w", encoding="utf-8") as f:
        json.dump(dicData, f, ensure_ascii=False, indent=2)


def _FnSlug(strLabel: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(strLabel or "custom").strip().lower()).strip("-")
    return s or "custom"


# ----------------------------------------------------------------- CRUD ----
def FnAddProvider(str_label: str, str_base: str, str_key: str = "",
                  v_models: Optional[List[str]] = None, str_lang: str = "") -> Dict[str, Any]:
    """Add a user provider (persisted to JSON file). Returns the entry (key masked)."""
    strBase = (str_base or "").rstrip("/")
    if not str_label or not strBase:
        raise ValueError("label 與 base URL 不可為空" if str_lang.startswith("zh") else "Label and base URL are required")
    dicData = _FnLoadFileProviders()
    vP = dicData["providers"]
    strId = _FnSlug(str_label)
    if any(p.get("id") == strId for p in vP):
        strId = f"{strId}-{len(vP) + 1}"
    dicEntry = {"id": strId, "label": str_label.strip(), "base": strBase,
                "key": str_key or "",
                "models": [m.strip() for m in (v_models or []) if str(m).strip()] or ["default"]}
    vP.append(dicEntry)
    dicData["providers"] = vP
    _FnSaveFileProviders(dicData)
    return {**dicEntry, "key": "***" if dicEntry["key"] else ""}


def FnDeleteProvider(str_id: str) -> bool:
    """Delete a file-based user provider. Built-in/env ones are protected."""
    dicData = _FnLoadFileProviders()
    vP = dicData["providers"]
    vKept = [p for p in vP if p.get("id") != str_id]
    if len(vKept) == len(vP):
        return False
    dicData["providers"] = vKept
    if (dicData.get("current") or {}).get("provider") == str_id:
        dicData["current"] = {}
    _FnSaveFileProviders(dicData)
    return True


def _FnFindProviderEntry(str_id: str) -> Optional[Dict[str, Any]]:
    strId = (str_id or "").strip().lower()
    if strId == "custom" and CUSTOM_BASE:
        return {"id": "custom", "label": "Custom", "base": CUSTOM_BASE,
                "key": CUSTOM_KEY, "models": [m.strip() for m in CUSTOM_MODEL.split(",") if m.strip()] or ["default"],
                "proto": "openai"}
    if not strId:
        return None
    for dicP in _FnLoadFileProviders().get("providers", []):
        if str(dicP.get("id") or "").strip().lower() == strId:
            return {**dicP, "proto": "openai"}
    return None


# ---------------------------------------------------------- connectivity ----
def FnTestProvider(str_id: str, str_lang: str = "") -> Dict[str, Any]:
    """Connectivity test: GET <base>/models (OpenAI-compatible)."""
    bZh = str(str_lang or "").strip().lower().replace("_", "-").startswith("zh")
    dicP = _FnFindProviderEntry(str_id)
    if not dicP:
        return {"ok": False, "error": f"找不到 provider {str_id}" if bZh else f"Provider {str_id} not found"}
    try:
        dicHeaders = {}
        if dicP.get("key"):
            dicHeaders["Authorization"] = "Bearer " + dicP["key"]
        oReq = urllib.request.Request(dicP["base"] + "/models", headers=dicHeaders, method="GET")
        with urllib.request.urlopen(oReq, timeout=10) as oRes:
            dicData = json.loads(oRes.read().decode("utf-8"))
        vModels = [m.get("id") for m in (dicData.get("data") or []) if m.get("id")]
        if vModels:
            strInfo = f"{len(vModels)} 個模型：{'、'.join(vModels[:8])}" if bZh else f"{len(vModels)} models: {', '.join(vModels[:8])}"
        else:
            strInfo = "連通（無模型列表）" if bZh else "Connected (no model list)"
        return {"ok": True, "info": strInfo}
    except Exception as oErr:
        return {"ok": False, "error": f"{type(oErr).__name__}: {oErr}"}


def FnListRemoteModels(str_base: str, str_key: str = "") -> Dict[str, Any]:
    """Fetch model ids from an OpenAI or Anthropic compatible GET <base>/models endpoint."""
    strBase = (str_base or "").rstrip("/")
    if not strBase:
        return {"ok": False, "error": "Base URL 不可為空" if (str_lang or "").startswith("zh") else "Base URL cannot be empty"}
    
    # Auto detect protocol & headers
    dicHeaders = {"User-Agent": "DocGraphical/1.0"}
    is_anthropic = "anthropic.com" in strBase or "claude" in strBase.lower()
    
    if str_key:
        if is_anthropic:
            dicHeaders["x-api-key"] = str_key
            dicHeaders["anthropic-version"] = "2023-06-01"
        else:
            dicHeaders["Authorization"] = "Bearer " + str_key

    # Try 1: Standard /models
    url1 = strBase + "/models" if not strBase.endswith("/models") else strBase
    # Try 2: If base lacks /v1 and failed, test /v1/models
    url2 = strBase + "/v1/models" if not strBase.endswith("/v1") and not strBase.endswith("/models") else url1

    for target_url in [url1, url2]:
        try:
            oReq = urllib.request.Request(target_url, headers=dicHeaders, method="GET")
            with urllib.request.urlopen(oReq, timeout=10) as oRes:
                dicData = json.loads(oRes.read().decode("utf-8"))
            
            # OpenAI style { "data": [{"id": ...}] }
            vModels = [m.get("id") for m in (dicData.get("data") or []) if m.get("id")]
            # Anthropic style { "models": [{"id": ...}] } or direct list
            if not vModels and "models" in dicData:
                vModels = [m.get("id") or m.get("name") for m in dicData.get("models") if m]
            
            if vModels:
                return {"ok": True, "models": vModels, "kind": "anthropic" if is_anthropic else "openai"}
        except Exception:
            continue

    # Fallback preset list for official Anthropic if /models is restricted
    if is_anthropic:
        return {
            "ok": True,
            "models": [
                "claude-3-7-sonnet-latest",
                "claude-3-5-sonnet-latest",
                "claude-3-5-haiku-latest",
                "claude-3-opus-latest"
            ],
            "kind": "anthropic"
        }

    return {"ok": False, "error": "無法取得模型清單，請確認 URL 與 API 金鑰"}


def FnGetOpencodePresets() -> List[Dict[str, Any]]:
    """Parse local opencode config to discover configured providers & models."""
    presets: List[Dict[str, Any]] = []
    p_jsonc = os.path.expanduser("~/.config/opencode/opencode.jsonc")
    p_json = os.path.expanduser("~/.config/opencode/opencode.json")
    target = p_jsonc if os.path.exists(p_jsonc) else (p_json if os.path.exists(p_json) else None)
    if target:
        try:
            with open(target, "r", encoding="utf-8") as f:
                c = f.read()
            lines = [l for l in c.splitlines() if not l.strip().startswith("//")]
            clean_text = "\n".join(lines)
            clean_text = re.sub(r'/\*.*?\*/', '', clean_text, flags=re.DOTALL)
            clean_text = re.sub(r',\s*([\]}])', r'\1', clean_text)
            data = json.loads(clean_text, strict=False)
            for pid, pdata in data.get("provider", {}).items():
                name = pdata.get("name") or pid
                opts = pdata.get("options", {})
                base = opts.get("baseURL") or opts.get("base") or ""
                key = opts.get("apiKey") or opts.get("key") or ""
                models = list((pdata.get("models") or {}).keys())
                presets.append({
                    "id": f"opencode_{pid}",
                    "label": f"{name} (Opencode)",
                    "category": "Local",
                    "base": base,
                    "key": key,
                    "models": models,
                    "suggest": models,
                    "urlMode": "edit",
                    "keyMode": "optional",
                    "source": "opencode"
                })
        except Exception as e:
            pass
    return presets
