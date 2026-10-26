"""Unit and API tests for Docgraphical Prompt Management."""
import os
import tempfile
import pytest
from docgraphical.prompts import (
    FnLoadPrompts, FnSavePrompt, FnResetPromptToDefault, FnGetPrompt, DEFAULT_PROMPTS
)
from docgraphical.server import create_app

@pytest.fixture
def temp_prompts_file(monkeypatch):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    monkeypatch.setenv("DOCGRAPH_PROMPTS_FILE", path)
    yield path
    if os.path.exists(path):
        os.remove(path)

def test_load_default_prompts(temp_prompts_file):
    prompts = FnLoadPrompts()
    assert "concept_scan" in prompts
    assert "crawl_seed" in prompts
    assert "crawl_file" in prompts
    assert "crawl_finish" in prompts
    assert "ingest_text" in prompts
    assert "ingest_vision" in prompts
    assert len(prompts["concept_scan"]["template"]) > 0

def test_save_and_get_prompt(temp_prompts_file):
    res = FnSavePrompt(
        prompt_key="concept_scan",
        system="Custom System Prompt",
        template="Custom Template with {official_concepts} and {candidates}",
        name="自訂概念審查"
    )
    assert res["ok"] is True

    # Retrieve and check
    current = FnGetPrompt("concept_scan")
    assert current["system"] == "Custom System Prompt"
    assert "{official_concepts}" in current["template"]
    assert current["name"] == "自訂概念審查"

def test_reset_prompt_to_default_zh_and_en(temp_prompts_file):
    # Reset to English
    res_en = FnResetPromptToDefault("concept_scan", lang="en")
    assert res_en["ok"] is True
    assert "concept curator" in res_en["data"]["template"].lower()

    # Reset to Japanese
    res_ja = FnResetPromptToDefault("concept_scan", lang="ja")
    assert res_ja["ok"] is True
    assert "ナレッジベース" in res_ja["data"]["template"]

    # Reset back to Traditional Chinese
    res_zh = FnResetPromptToDefault("concept_scan", lang="zh")
    assert res_zh["ok"] is True
    assert "繁體中文知識庫" in res_zh["data"]["template"]

def test_prompt_api_endpoints(temp_prompts_file):
    app = create_app()
    client = app.test_client()

    # 1. GET /api/prompts
    res = client.get("/api/prompts")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert "concept_scan" in data["prompts"]

    # 2. POST /api/prompts/save
    res = client.post("/api/prompts/save", json={
        "key": "ingest_text",
        "system": "API System Prompt",
        "template": "API Template {source_names} {text}",
        "name": "API Ingest"
    })
    assert res.status_code == 200
    assert res.get_json()["ok"] is True

    # Verify saved via GET
    res = client.get("/api/prompts")
    p = res.get_json()["prompts"]["ingest_text"]
    assert p["system"] == "API System Prompt"
    assert p["template"] == "API Template {source_names} {text}"

    # 3. POST /api/prompts/reset
    res = client.post("/api/prompts/reset", json={
        "key": "ingest_text",
        "lang": "en"
    })
    assert res.status_code == 200
    p = res.get_json()["data"]
    assert "technical document" in p["template"].lower()
