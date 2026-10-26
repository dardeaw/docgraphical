"""Prompt template management and runtime resolution for DocGraphical.

Maintains customizable prompts for:
1. concept_scan   (Judge mining candidates)
2. crawl_seed      (Find start footholds)
3. crawl_file      (Batch extract verbatim mentions and push next)
4. crawl_finish    (Finalize kept/dropped and suggest title)
5. ingest_text     (Markdown tech summary)
6. ingest_vision   (Multimodal page/slide summary)

Storage:
- File: ~/.docgraphical/prompts.json
- Defaults provided in multiple languages: zh (Traditional Chinese), en (English), ja (Japanese).
- 'Reset to Default' restores the built-in template for the requested UI language.
"""

import json
import os
from typing import Any, Dict

DEFAULT_PROMPTS: Dict[str, Dict[str, Dict[str, str]]] = {
    "zh": {
        "concept_scan": {
            "name": "概念發掘審查",
            "system": "只輸出 JSON 陣列，不要解釋。",
            "template": (
                "你是繁體中文知識庫概念策展人。以下是在多份文件中都出現的高頻候選詞 "
                "(DF=出現文件數)。請挑出真正值得收成知識庫概念的領域術語，刪除通用廢話 "
                "(如狀況、進行、報告這類放諸四海皆準的詞)。已收錄概念：{official_concepts}。"
                "值得收的範例：具體設備名（水冷分配櫃、拉釘機）、專利/規格代號、"
                "供應商/客戶名、工藝步驟名。不值得收的範例：通用動詞/形容詞、"
                "英文碎片段（ae、loo、update）、單純品牌字的一部分。"
                "只回 JSON 陣列，不要其它文字："
                "[{\"term\": \"...\", \"reason\": \"...8字內...\", \"merge_into\": \"已收錄名或空字串\"}]"
                "\n候選：\n{candidates}"
            ),
        },
        "crawl_seed": {
            "name": "順藤摸瓜：起點帶路",
            "system": "你是知識庫的帶路人。用繁體中文思考。",
            "template": (
                "使用者想找：{seed}\n"
                "字面落點（免費解析，可留可棄）：\n{literal_points}\n"
                "總綱內文：\n{catalog_text}\n"
                "收過的：{official_concepts}\n"
                "還在等的：{candidate_concepts}\n\n"
                "只看上面，選最值得先摸的起點（呼應使用者想找的；種子寫概念名或檔名都行）。"
                "每行一條，格式 `走：XXX｜理由：Y`，理由{reason_rule}，最多 {max_starts} 行，不要解釋其他話。"
            ),
        },
        "crawl_file": {
            "name": "順藤摸瓜：逐檔摸瓜提取",
            "system": "你是知識庫的摸瓜人。用繁體中文。段只路過，不給入 stack。無關就念空入空，不要硬湊。逐檔回答，每檔用 @檔： 起頭。",
            "template": (
                "使用者在找：{seed}\n"
                "下面 {count} 個檔一起判。只念與該檔內文相關的概念、只入與使用者想找的相關的下批；無關的念空入空。"
                "任務一：每檔的相關概念，必須是該檔內文原字原句（照抄，不准改字、不准縮寫、不是原句不念），每行 `念：原句｜由：八字`，可多行。"
                "任務二：下批入 stack（整輪合併，不重複），每行 `入：XXX`（檔寫路徑、概念寫名），每檔最多 {max_push} 行。"
                "黑名單詞不要念。只要行，不要解釋。\n"
                "{file_blocks}"
            ),
        },
        "crawl_finish": {
            "name": "順藤摸瓜：整輪終審",
            "system": "你是知識庫的終審。用繁體中文。",
            "template": (
                "使用者在找：{seed}\n"
                "整輪摸到的暫存（檔＋念到的詞）：\n{staged_items}\n\n"
                "任務一：逐條判留去，只留跟使用者想找的相關的，每行 `留：詞 @ 檔` 或 `去：詞 @ 檔`。"
                "任務二：依全部語意薦一個最能回答它的概念詞作標題，一行 `題：詞｜由：八字`。只要行，不要解釋。"
            ),
        },
        "ingest_text": {
            "name": "文件攝入：純文字摘要",
            "system": "你是繁體中文技術文件摘要助手，只輸出 Markdown。",
            "template": (
                "你是一位技術文件整理助手。請用繁體中文把以下文件內容整理成一份 "
                "Markdown 摘要（開頭一個 # 主標題，## 章節，重點用條列，保留關鍵術語、"
                "數字與專有名詞原文）。\n"
                "來源檔案：{source_names}\n\n"
                "===== 文件內容開始 =====\n{text}\n===== 文件內容結束 ====="
            ),
        },
        "ingest_vision": {
            "name": "文件攝入：圖片/多模態摘要",
            "system": "你是繁體中文技術文件摘要助手，只輸出 Markdown。",
            "template": (
                "你是一位技術文件整理助手。以下是同一份文件的頁面截圖（按順序），"
                "請用繁體中文看圖整理成一份 Markdown 摘要（開頭一個 # 主標題，"
                "## 章節，重點用條列，保留圖中關鍵術語、數字與專有名詞原文；"
                "看不清楚的地方照實說，不要編造）。\n"
                "來源檔案：{source_names}"
            ),
        },
    },
    "en": {
        "concept_scan": {
            "name": "Concept Scan Curation",
            "system": "Output only a JSON array, no extra explanations.",
            "template": (
                "You are a knowledge base concept curator. Below are high-frequency candidate terms extracted "
                "across multiple documents (DF = document frequency). Select domain terms worthy of indexing, "
                "and exclude generic filler words. Registered concepts: {official_concepts}."
                "Good examples: specific equipment, patent/spec codes, vendor/client names, process steps. "
                "Bad examples: generic verbs/adjectives, broken English fragments, incomplete brand names. "
                "Return ONLY a JSON array:\n"
                "[{\"term\": \"...\", \"reason\": \"...8 words max...\", \"merge_into\": \"existing name or empty string\"}]"
                "\nCandidates:\n{candidates}"
            ),
        },
        "crawl_seed": {
            "name": "Vine Crawl: Seed Footholds",
            "system": "You are a knowledge base guide. Think in English.",
            "template": (
                "User is searching for: {seed}\n"
                "Literal entry points (free AST matches):\n{literal_points}\n"
                "Catalog overview:\n{catalog_text}\n"
                "Existing concepts: {official_concepts}\n"
                "Pending candidates: {candidate_concepts}\n\n"
                "Select the most promising starting footholds. "
                "Format one per line: `走：XXX｜理由：Y`, reason {reason_rule}, up to {max_starts} lines, no extra words."
            ),
        },
        "crawl_file": {
            "name": "Vine Crawl: File Inspection",
            "system": "You are a knowledge crawler. Do not push sections to stack. Answer per file starting with @檔：.",
            "template": (
                "User is searching for: {seed}\n"
                "Evaluate the following {count} files. Only extract concepts strictly relevant to each file's text, "
                "and only push items relevant to user's search. "
                "Task 1: Concepts must be VERBATIM quotes from the file (no paraphrasing), formatted as `念：verbatim｜由：brief reason`. "
                "Task 2: Next batch to push into stack, formatted as `入：target` (up to {max_push} items per file). "
                "Do not extract blacklisted terms. Return lines only, no explanations.\n"
                "{file_blocks}"
            ),
        },
        "crawl_finish": {
            "name": "Vine Crawl: Final Review",
            "system": "You are the final review agent for the knowledge crawl.",
            "template": (
                "User is searching for: {seed}\n"
                "Staged findings across this run:\n{staged_items}\n\n"
                "Task 1: Judge keep or drop for each item. Format as `留：term @ file` or `去：term @ file`.\n"
                "Task 2: Recommend one best concept term answering the search as title. Format as `題：term｜由：reason`.\n"
                "Lines only, no explanations."
            ),
        },
        "ingest_text": {
            "name": "Ingestion: Text Document Summary",
            "system": "You are a technical document summarizer. Output only Markdown.",
            "template": (
                "You are a technical document assistant. Summarize the following document into a structured Markdown "
                "document (# Title, ## Sections, bullet points, preserving key technical terms, metrics, and proper nouns).\n"
                "Source file: {source_names}\n\n"
                "===== Document Content Begin =====\n{text}\n===== Document Content End ====="
            ),
        },
        "ingest_vision": {
            "name": "Ingestion: Multimodal / Image Summary",
            "system": "You are a technical document summarizer. Output only Markdown.",
            "template": (
                "You are a technical document assistant. Below are page screenshots from the same document in order. "
                "Generate a Markdown summary (# Title, ## Sections, bullet points, preserving exact terms, metrics, numbers; "
                "state honestly if parts are unreadable, never hallucinate).\n"
                "Source file: {source_names}"
            ),
        },
    },
    "ja": {
        "concept_scan": {
            "name": "概念キュレーション審査",
            "system": "JSON配列のみを出力し、説明は一切含めないでください。",
            "template": (
                "あなたはナレッジベースの概念キュレーターです。以下は複数ドキュメントから抽出された高頻度候補語句です "
                "(DF=出現ドキュメント数)。ナレッジベースに登録すべき専門用語を選び、一般的な不要語を除外してください。"
                "登録済み概念：{official_concepts}。"
                "収集すべき例：具体的装置名、特許・規格コード、取引先名、工程名。"
                "除外すべき例：一般的な動詞・形容詞、断片的な英字、ブランド名の一部。"
                "JSON配列のみを返してください：\n"
                "[{\"term\": \"...\", \"reason\": \"...8文字以内...\", \"merge_into\": \"既存概念名または空文字\"}]"
                "\n候補：\n{candidates}"
            ),
        },
        "crawl_seed": {
            "name": "知識探索：起点案内",
            "system": "あなたはナレッジベースの案内人です。",
            "template": (
                "検索対象：{seed}\n"
                "字面の一致点：\n{literal_points}\n"
                "概要内文：\n{catalog_text}\n"
                "登録済み概念：{official_concepts}\n"
                "保留中の候補：{candidate_concepts}\n\n"
                "上記から最も探る価値のある起点を選んでください。"
                "1行に1項目、書式 `走：XXX｜理由：Y`、理由{reason_rule}、最大 {max_starts} 行、説明文は不要です。"
            ),
        },
        "crawl_file": {
            "name": "知識探索：ファイル別抽出",
            "system": "あなたはナレッジ探索エージェントです。各ファイルごとに @檔： から始めて回答してください。",
            "template": (
                "検索対象：{seed}\n"
                "以下の {count} 件のファイルを判定してください。内文に真に関連する概念のみ抽出し、次に探索すべき対象のみスタックに追加してください。"
                "任務1：概念は必ずファイル内文の原文そのまま（改変・略称不可）を抽出し、`念：原文｜由：理由` の形式で出力してください。"
                "任務2：次にスタックへ積む対象を `入：XXX` の形式で出力（ファイル最大 {max_push} 行）。"
                "ブラックリスト語句は抽出しないでください。行のみ出力し、解説は不要です。\n"
                "{file_blocks}"
            ),
        },
        "crawl_finish": {
            "name": "知識探索：最終審査",
            "system": "あなたはナレッジ探索の最終審査エージェントです。",
            "template": (
                "検索対象：{seed}\n"
                "今回探索で一時保存された一覧：\n{staged_items}\n\n"
                "任務1：各項目を判定し、`留：語句 @ ファイル` または `去：語句 @ ファイル` で出力。"
                "任務2：全体を代表する概念名を1つ `題：語句｜由：理由` で推薦。"
                "行のみ出力し、説明は含めないでください。"
            ),
        },
        "ingest_text": {
            "name": "文書取り込み：テキスト要約",
            "system": "あなたは技術文書要約アシスタントです。Markdownのみを出力してください。",
            "template": (
                "あなたは技術文書整理アシスタントです。以下の内容をMarkdown要約として整理してください"
                "（先頭に # タイトル、## 章立て、箇条書き、専門用語・数値・固有名詞は原文維持）。\n"
                "元ファイル：{source_names}\n\n"
                "===== 文書内容開始 =====\n{text}\n===== 文書内容終了 ====="
            ),
        },
        "ingest_vision": {
            "name": "文書取り込み：画像・マルチモーダル要約",
            "system": "あなたは技術文書整理アシスタントです。Markdown形式のみで出力してください。",
            "template": (
                "あなたは技術文書整理アシスタントです。以下は同一文書の連続スライド／ページ画像です。"
                "画像を見てMarkdown要約を作成してください（# タイトル、## 章立て、箇条書き、専門用語・数値を保持し、不鮮明な箇所は推測せず明記してください）。\n"
                "元ファイル：{source_names}"
            ),
        },
    },
}


def _FnPromptsPath() -> str:
    return os.environ.get("DOCGRAPH_PROMPTS_FILE") or os.path.join(
        os.path.expanduser("~"), ".docgraphical", "prompts.json"
    )


def FnLoadPrompts() -> Dict[str, Dict[str, str]]:
    """Load stored custom prompts, merged with default 'zh' templates."""
    path = _FnPromptsPath()
    custom: Dict[str, Any] = {}
    try:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                custom = json.load(f)
    except Exception:
        custom = {}

    result: Dict[str, Dict[str, str]] = {}
    base_defaults = DEFAULT_PROMPTS.get("zh", {})
    for key, item in base_defaults.items():
        c_item = custom.get(key) if isinstance(custom.get(key), dict) else {}
        result[key] = {
            "name": c_item.get("name") or item["name"],
            "system": c_item.get("system") if "system" in c_item else item["system"],
            "template": c_item.get("template") if "template" in c_item else item["template"],
        }
    return result


def FnSavePrompt(prompt_key: str, system: str, template: str, name: str = "") -> Dict[str, Any]:
    """Save/update a single prompt template."""
    prompts = FnLoadPrompts()
    if prompt_key not in prompts and prompt_key not in DEFAULT_PROMPTS["zh"]:
        return {"ok": False, "error": f"Unknown prompt key: {prompt_key}"}

    existing = prompts.get(prompt_key, {})
    prompts[prompt_key] = {
        "name": name.strip() or existing.get("name") or prompt_key,
        "system": system if system is not None else existing.get("system", ""),
        "template": template if template is not None else existing.get("template", ""),
    }

    path = _FnPromptsPath()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(prompts, f, ensure_ascii=False, indent=2)
        return {"ok": True, "prompt_key": prompt_key, "data": prompts[prompt_key]}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def FnResetPromptToDefault(prompt_key: str, lang: str = "zh") -> Dict[str, Any]:
    """Reset a prompt to the built-in default for the given language."""
    lang_key = lang if lang in DEFAULT_PROMPTS else "zh"
    defaults = DEFAULT_PROMPTS.get(lang_key, DEFAULT_PROMPTS["zh"])
    if prompt_key not in defaults:
        return {"ok": False, "error": f"Unknown prompt key: {prompt_key}"}

    target = defaults[prompt_key]
    save_res = FnSavePrompt(prompt_key, target["system"], target["template"], target["name"])
    if not save_res.get("ok"):
        return save_res
    return {
        "ok": True,
        "prompt_key": prompt_key,
        "lang": lang_key,
        "data": target,
    }


def FnGetPrompt(prompt_key: str) -> Dict[str, str]:
    """Retrieve active system and template for runtime caller."""
    prompts = FnLoadPrompts()
    if prompt_key in prompts:
        return prompts[prompt_key]
    return DEFAULT_PROMPTS["zh"].get(prompt_key, {"system": "", "template": "", "name": prompt_key})


def FnGetDefaultPrompts(lang: str = "zh") -> Dict[str, Dict[str, str]]:
    """Get built-in default prompts for a given language."""
    lang_key = lang if lang in DEFAULT_PROMPTS else "zh"
    return DEFAULT_PROMPTS.get(lang_key, DEFAULT_PROMPTS["zh"])
