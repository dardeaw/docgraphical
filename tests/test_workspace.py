import pytest
import os
import tempfile
import json
from docgraphical import workspace


def test_workspaces_crud():
    # Use temporary manifest & root
    with tempfile.TemporaryDirectory() as tmp_dir:
        test_manifest = os.path.join(tmp_dir, "manifest.json")
        test_ws_dir = os.path.join(tmp_dir, "workspaces")
        workspace.MANIFEST_FILE = test_manifest
        workspace.WORKSPACES_ROOT = test_ws_dir

        # 1. Default creation
        manifest = workspace.get_manifest()
        assert manifest["active"] == "default"
        ws_list = workspace.list_workspaces()
        assert len(ws_list) >= 1
        assert ws_list[0]["id"] == "default"

        # 2. Create new workspace
        res = workspace.create_workspace("研發專案庫")
        assert res["success"] is True
        new_id = res["workspace"]["id"]
        assert "研發專案庫" in res["workspace"]["name"]

        # 3. Rename workspace
        ren_res = workspace.rename_workspace(new_id, "2026_伺服器研發專案")
        assert ren_res["success"] is True
        assert ren_res["name"] == "2026_伺服器研發專案"

        # 4. Switch workspace
        sw_res = workspace.switch_workspace(new_id)
        assert sw_res["success"] is True
        assert workspace.get_active_workspace_id() == new_id

        # 5. Save and load workspace roots
        test_roots = ["D:/FakeProjectA", "D:/FakeProjectB"]
        workspace.save_workspace_config({"custom_roots": test_roots, "excluded_paths": []}, ws_id=new_id)
        loaded_cfg = workspace.load_workspace_config(new_id)
        assert loaded_cfg["custom_roots"] == test_roots

        # 6. Verify Prompts and LLM isolation per workspace
        from docgraphical import prompts, llm_provider
        # Set workspace specific prompt in new_id
        prompts.FnSavePrompt("concept_scan", "專案專屬系統提示詞", "專案專屬模板")
        loaded_p = prompts.FnGetPrompt("concept_scan")
        assert loaded_p["system"] == "專案專屬系統提示詞"

        # Switch back to default
        workspace.switch_workspace("default")
        def_p = prompts.FnGetPrompt("concept_scan")
        # In default workspace it shouldn't be overwritten by new_id
        assert def_p["system"] != "專案專屬系統提示詞"

        # Switch back to new_id
        workspace.switch_workspace(new_id)
        assert prompts.FnGetPrompt("concept_scan")["system"] == "專案專屬系統提示詞"

        # 7. Delete workspace
        del_res = workspace.delete_workspace(new_id)
        assert del_res["success"] is True
        assert workspace.get_active_workspace_id() == "default"
        assert not os.path.exists(workspace.get_workspace_dir(new_id, ensure=False))
