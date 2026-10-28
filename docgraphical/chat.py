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
import urllib.request
from typing import Any, Dict, Generator, List, Optional

from .llm_provider import FnResolveActiveLLM
from .mcp_server import MCP_TOOLS_SPEC, execute_mcp_tool


SYSTEM_PROMPT = """你是由 DocGraphical 知識地圖驅動的 AI 知識檢索專家。
你的任務是協助使用者檢索、研讀並回答知識庫中的問題。

你的中介層已連接 DocGraphical 專屬 MCP 檢索工具，本質上分為兩種檢索模式，請依據使用者的提問意圖自主決策調用順序：

【檢索雙軌模式（由你自主判斷選用）】：
1. 🌐 全庫宏觀探索（Global Broad Search）：
   - 工具：`docgraphical_search(query, filePath="")`
   - 何時用：當使用者詢問跨文件概念、實體名稱（例如「CVX」、「伺服器」、「營收」），或當前文件無法完整回答、或使用者未限定特定單一檔案時。
   - 技巧：請將 query 提煉為 1~3 個核心關鍵字（如 `CVX 產品`、`產能`），直接進行跨庫掃描，定位全庫有哪些相關文檔。

2. 🎯 精準切片點菜（Precision Slicing）：
   - 工具：`docgraphical_toc(filePath)` 與 `docgraphical_section(filePath, heading)`
   - 何時用：當使用者明確針對特定文件詢問，或你已透過 Global Search 鎖定 1~2 份目標文檔後。
   - 技巧：先調用 `docgraphical_toc` 查看目錄結構，再調用 `docgraphical_section` 提取對應章節，零浪費全檔 Token。

【回答規範】：
- 視野宏大：切勿把自己限制在單一文件的死角。若使用者的問題涉及多面向，先做 Global Search 掌握全局，再進入目標文件 Precision Slicing！
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
    max_tool_rounds: int = 5,
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
            ctx_note = f"\n[提示] 使用者目前畫面開啟之文件為：`{active_doc}`（僅供參考，若問題屬跨文件或全局概念，請自主決定是否使用 Global Search 探索全庫）。"
        if search_roots:
            ctx_note += f"\n知識庫搜尋根目錄：{json.dumps(search_roots, ensure_ascii=False)}"
        msg_history.append({"role": "system", "content": SYSTEM_PROMPT + ctx_note})

    for m in messages:
        msg_history.append({
            "role": m.get("role", "user"),
            "content": m.get("content", ""),
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

    # End of rounds limit reached
    yield f"data: {json.dumps({'type': 'done', 'ok': True, 'rounds': round_idx, 'truncated': True}, ensure_ascii=False)}\n\n"
