# -*- coding: utf-8 -*-
"""DocGraphical Knowledge Chat Engine via Model Context Protocol (MCP).

Provides:
- In-process and network MCP tool orchestration (TOC, Section, Search, Graph).
- OpenAI-compatible Function Calling loop (Streaming or Single-response).
- Grounded citations linking to verbatim documents and headings (`[[file#heading]]`).
- SSE streaming generator for `/api/chat`.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Any, Dict, Generator, List, Optional

from .llm_provider import FnResolveActiveLLM
from .mcp_server import MCP_TOOLS_SPEC, execute_mcp_tool


SYSTEM_PROMPT = """你是由 DocGraphical 知識地圖驅動的 AI 知識檢索專家。
你的任務是協助使用者檢索、研讀並回答知識庫中的問題。

你的中介層已連接 DocGraphical 專屬 MCP 檢索工具，本質上分為兩種檢索模式，請依據使用者的提問意圖自主決策調用順序：

【檢索模式與優先順序（重要！）】：
1. 🎯 當前上下文優先（Active Context First）：
   - 若使用者已綁定或正在閱讀特定文件（即當前上下文 `active_doc`），或提問明顯延續上一輪在討論的同一份文件：
   - 你的第一優先搜索路徑必須是該文件！
   - 調用 `docgraphical_search(query, filePath=active_doc)` 或直接對該文件調用 `docgraphical_toc(active_doc)` / `docgraphical_section(active_doc, heading)`！
   - 只有在當前文件中確定「查無此內容」或使用者明指「跨庫/其他專案」時，才擴大為全庫宏觀探索（`filePath=""`）！

2. 🌐 全庫宏觀探索（Global Broad Search）：
   - 工具：`docgraphical_search(query, filePath="")`
   - 何時用：使用者詢問全庫跨文件概念、實體名稱、當前上下文未綁定特定文件、或當前文件查無對應內容時。
   - 技巧：請將 query 提煉為 1~3 個核心關鍵字，直接進行跨庫掃描，定位全庫有哪些相關文檔。

3. 🎯 精準切片點菜（Precision Slicing）：
   - 工具：`docgraphical_toc(filePath)` 與 `docgraphical_section(filePath, heading)`
   - 何時用：針對目標文件調閱結構與章節，零浪費全檔 Token。

【多輪自主導航與深挖心法（重要！）】：
1. 充分性檢驗（Sufficiency Check）：
   - 對話歷史中已加載之章節若內容充足，直接提煉回答，零多餘調用。
   - 若歷史內容僅屬綱要（如摘要、會議總結）、摸到邊緣、或缺乏具體數據，必須主動「順藤摸瓜」，調用該檔案深入章節（如規格、出貨時程）或相鄰關聯文檔！
2. 剪枝與變更航道（Pruning & Pivot）：
   - 若上一輪搜尋的關鍵字或路徑已被證明「查無內容」或「無效」，請將其視為死胡同，嚴禁重複嘗試！
   - 自主切換同義詞、概念標籤（Concepts）或相鄰文件摸索出去！

【多模態圖像與視覺感知（重要！）】：
- 視覺優先理解（Vision Comprehension）：任何時候只要使用者的提問中包含圖片、截圖或圖表附件，你的第一本能必須是「仔細看懂整張圖片的所有像素與細節」！
  • 包含但不限於：程式碼、錯誤訊息、規格參數、架構圖、流程圖、UI 介面、數據圖表、日誌文字等。
  • 無論使用者是問出處、問如何修改、問原理、問 bug、還是要你解讀圖意，都要將圖片中的所有可見資訊視為「使用者提問的第一手核心輸入」！
  • 嚴禁忽視圖片、嚴禁拿暫存檔名（如 `pasted_img_xxxx`）當作關鍵字。請直接基於圖片所呈現的真實內容進行推理、回答或發動 MCP 檢索！

【回答規範】：
- 引用錨點：回答中的每項重要事實與結論，句尾必須附上精準引用來源，格式嚴格為：`[[檔案名稱#章節名稱]]`（例如：`[[Cooler Master x Chenbro Business Update 20260629 FOR 越南工廠摘要.md### 八、CVX 產能與生產線建構]]`），前端會自動轉為可點擊跳轉錨點與 3D 地圖定位！
- 專業簡潔：使用繁體中文（或使用者提問之語言）回答。
"""


def _prepare_headers(tgt: Dict[str, Any]) -> Dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
    }
    if tgt.get("key"):
        headers["Authorization"] = f"Bearer {tgt['key']}"
    return headers


def stream_chat_turn(
    messages: List[Dict[str, Any]],
    search_roots: Optional[List[str]] = None,
    active_doc: Optional[str] = None,
    max_tool_rounds: int = 8,
) -> Generator[str, None, None]:
    """Execute a full tool-augmented chat loop and yield Server-Sent Events (SSE).
    
    Each yielded chunk is formatted as:
        data: {"type": "...", ...}\n\n
    Types:
        - "ping": Keepalive
        - "tool_call": Tool invoked {call_id, name, arguments}
        - "tool_result": Tool execution output {call_id, name, result}
        - "delta": Streamed assistant text tokens {content}
        - "citation": Extracted document anchor {file, heading}
        - "done": Finished loop {ok, total_rounds}
        - "error": Error message {error}
    """
    tgt = FnResolveActiveLLM()
    if not tgt.get("ok"):
        err = tgt.get("error") or "No active LLM provider configured. Please check Settings."
        yield f"data: {json.dumps({'type': 'error', 'error': err}, ensure_ascii=False)}\n\n"
        return

    # Build initial message stack
    msg_history: List[Dict[str, Any]] = []
    
    # Check if system prompt already present
    has_system = any(m.get("role") == "system" for m in messages)
    if not has_system:
        ctx_note = ""
        if active_doc:
            ctx_note = f"\n[核心上下文] 使用者目前畫面開啟且綁定之目標文件為：`{active_doc}`。使用者提問或貼圖若未特別指名其他檔案，預設即是在詢問此份文件！請優先針對此文件調用 TOC、Section 或 localized search 尋找出處！"
            # Ingest image index: inspect active_doc for embedded images/attachments
            try:
                from .parser import resolve_doc_path
                real_active = resolve_doc_path(active_doc)
                if os.path.isfile(real_active):
                    with open(real_active, "r", encoding="utf-8", errors="replace") as af:
                        doc_txt = af.read()
                    # Find all markdown images: ![alt](src)
                    doc_imgs = re.findall(r'!\[([^\]]*)\]\(([^)]+)\)', doc_txt)
                    if doc_imgs:
                        img_summary_list = []
                        for alt, src in doc_imgs[:30]:
                            bname = os.path.basename(src)
                            img_summary_list.append(f"- 檔名: `{bname}` | Alt: `{alt or '無'}` | 參照: `{src}`")
                        ctx_note += f"\n\n【當前文件內嵌圖片與附件清單 ({len(doc_imgs)} 個)】（若使用者給圖詢問出處，請優先比對以下圖片檔名與說明）：\n" + "\n".join(img_summary_list)
            except Exception:
                pass

        if search_roots:
            ctx_note += f"\n知識庫搜尋根目錄：{json.dumps(search_roots, ensure_ascii=False)}"
        
        # Karpathy KV-Cache optimization: Inject DOC_CATALOG.md into System Prompt
        catalog_content = ""
        try:
            cand_roots = []
            if active_doc and os.path.exists(active_doc):
                cand_roots.append(os.path.dirname(os.path.abspath(active_doc)))
            if search_roots:
                cand_roots.extend(search_roots)
            for cr in cand_roots:
                cat_file = os.path.join(cr, "DOC_CATALOG.md")
                if os.path.isfile(cat_file):
                    with open(cat_file, "r", encoding="utf-8", errors="replace") as cf:
                        catalog_content = cf.read(8000) # Capped at 8000 chars for KV Cache safety
                    break
        except Exception:
            catalog_content = ""

        if catalog_content:
            ctx_note += f"\n\n【全庫目錄地圖 (DOC_CATALOG.md)】（已快取，供你直接定位文件與章節，無需盲目搜尋）：\n```markdown\n{catalog_content}\n```"

        msg_history.append({"role": "system", "content": SYSTEM_PROMPT + ctx_note})

    img_extract_pat = re.compile(r"!\[.*?\]\((data:image\/[a-zA-Z0-9\-\+]+;base64,[^\)]+)\)")

    for m in messages:
        raw_content = m.get("content", "")
        role = m.get("role", "user")

        if role == "user" and isinstance(raw_content, str) and "data:image/" in raw_content:
            parts = []
            last_end = 0
            for match in img_extract_pat.finditer(raw_content):
                txt_before = raw_content[last_end:match.start()].strip()
                if txt_before:
                    parts.append({"type": "text", "text": txt_before})
                img_data_url = match.group(1).strip()
                parts.append({"type": "image_url", "image_url": {"url": img_data_url}})
                last_end = match.end()

            txt_rest = raw_content[last_end:].strip()
            # Clean up any residual pasted_img name captions
            txt_rest = re.sub(r"^\s*\(pasted_img_[^\)]+\)\s*", "", txt_rest).strip()
            if txt_rest:
                parts.append({"type": "text", "text": txt_rest})

            msg_history.append({
                "role": role,
                "content": parts if parts else raw_content,
                "tool_calls": m.get("tool_calls"),
                "tool_call_id": m.get("tool_call_id"),
                "name": m.get("name"),
            })
        else:
            msg_history.append({
                "role": role,
                "content": raw_content,
                "tool_calls": m.get("tool_calls"),
                "tool_call_id": m.get("tool_call_id"),
                "name": m.get("name"),
            })

    round_idx = 0
    while round_idx < max_tool_rounds:
        round_idx += 1
        
        # Build payload for OpenAI-compatible Chat Completion API
        payload_data = {
            "model": tgt["model"],
            "messages": [
                {k: v for k, v in m.items() if v is not None}
                for m in msg_history
            ],
            "tools": MCP_TOOLS_SPEC,
            "tool_choice": "auto",
            "stream": True,
        }
        
        # OpenAI reasoning models (gpt-5*, o1*, o3*, o4*) require reasoning_effort: none when using function tools in /v1/chat/completions
        model_name = (tgt.get("model") or "").lower()
        if any(prefix in model_name for prefix in ("gpt-5", "luna", "o1", "o3", "o4")):
            payload_data["reasoning_effort"] = "none"
        
        req = urllib.request.Request(
            f"{tgt['base']}/chat/completions",
            data=json.dumps(payload_data).encode("utf-8"),
            headers=_prepare_headers(tgt),
            method="POST",
        )

        curr_tool_calls: Dict[int, Dict[str, Any]] = {}
        curr_content_chunks: List[str] = []

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                for line in resp:
                    if not line:
                        continue
                    line_str = line.decode("utf-8", errors="replace").strip()
                    if not line_str.startswith("data:"):
                        continue
                    data_str = line_str[5:].strip()
                    if data_str == "[DONE]":
                        break
                    
                    try:
                        chunk = json.loads(data_str)
                    except Exception:
                        continue
                    
                    choice = (chunk.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    
                    # Accumulate streamed text content
                    text_delta = delta.get("content")
                    if text_delta:
                        curr_content_chunks.append(text_delta)
                        yield f"data: {json.dumps({'type': 'delta', 'content': text_delta}, ensure_ascii=False)}\n\n"
                    
                    # Accumulate streamed tool calls
                    tool_calls_delta = delta.get("tool_calls")
                    if tool_calls_delta:
                        for tc in tool_calls_delta:
                            idx = tc.get("index", 0)
                            if idx not in curr_tool_calls:
                                curr_tool_calls[idx] = {
                                    "id": tc.get("id") or f"call_{idx}",
                                    "type": "function",
                                    "function": {"name": "", "arguments": ""}
                                }
                            fn = tc.get("function") or {}
                            if "name" in fn and fn["name"]:
                                curr_tool_calls[idx]["function"]["name"] += fn["name"]
                            if "arguments" in fn and fn["arguments"]:
                                curr_tool_calls[idx]["function"]["arguments"] += fn["arguments"]
                                
        except Exception as e:
            err_msg = f"LLM stream connection error: {e}"
            yield f"data: {json.dumps({'type': 'error', 'error': err_msg}, ensure_ascii=False)}\n\n"
            return

        full_content = "".join(curr_content_chunks)
        
        # If no tool calls were generated, model completed its response
        if not curr_tool_calls:
            msg_history.append({"role": "assistant", "content": full_content})
            yield f"data: {json.dumps({'type': 'done', 'ok': True, 'rounds': round_idx}, ensure_ascii=False)}\n\n"
            return

        # There are tool calls to dispatch via MCP!
        # Convert dictionary to ordered list
        executed_tool_calls = [curr_tool_calls[k] for k in sorted(curr_tool_calls.keys())]
        msg_history.append({
            "role": "assistant",
            "content": full_content or None,
            "tool_calls": executed_tool_calls,
        })

        for tc in executed_tool_calls:
            call_id = tc["id"]
            fn_info = tc.get("function", {})
            fn_name = fn_info.get("name", "")
            raw_args = fn_info.get("arguments", "{}")
            
            try:
                parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except Exception:
                parsed_args = {}

            # Emit tool_call event to frontend
            yield f"data: {json.dumps({'type': 'tool_call', 'call_id': call_id, 'name': fn_name, 'arguments': parsed_args}, ensure_ascii=False)}\n\n"

            # Execute via our unified MCP dispatcher
            tool_output = execute_mcp_tool(fn_name, parsed_args)

            # Emit tool_result event to frontend
            preview = tool_output[:300] + ("..." if len(tool_output) > 300 else "")
            yield f"data: {json.dumps({'type': 'tool_result', 'call_id': call_id, 'name': fn_name, 'result_summary': preview}, ensure_ascii=False)}\n\n"

            # Feed result back into assistant message context
            msg_history.append({
                "role": "tool",
                "tool_call_id": call_id,
                "name": fn_name,
                "content": tool_output,
            })

    # If loop ends and no final text was output yet, force one last completion call with tools=None
    if not curr_content_chunks:
        try:
            final_payload = {
                "model": tgt["model"],
                "messages": [
                    {k: v for k, v in m.items() if v is not None}
                    for m in msg_history
                ],
                "stream": True,
            }
            if any(prefix in model_name for prefix in ("gpt-5", "luna", "o1", "o3", "o4")):
                final_payload["reasoning_effort"] = "none"
            final_req = urllib.request.Request(
                f"{tgt['base']}/chat/completions",
                data=json.dumps(final_payload).encode("utf-8"),
                headers=_prepare_headers(tgt),
                method="POST",
            )
            with urllib.request.urlopen(final_req, timeout=120) as resp:
                for line in resp:
                    if not line:
                        continue
                    line_str = line.decode("utf-8", errors="replace").strip()
                    if not line_str.startswith("data:"):
                        continue
                    data_str = line_str[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except Exception:
                        continue
                    choice = (chunk.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    text_delta = delta.get("content")
                    if text_delta:
                        curr_content_chunks.append(text_delta)
                        yield f"data: {json.dumps({'type': 'delta', 'content': text_delta}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'delta', 'content': f'\\n\\n(檢索完成，總結時發生錯誤: {e})'}, ensure_ascii=False)}\n\n"

    # End of rounds limit reached
    yield f"data: {json.dumps({'type': 'done', 'ok': True, 'rounds': round_idx, 'truncated': True}, ensure_ascii=False)}\n\n"
