# DocGraphical

[繁體中文](README.zh-TW.md) | [English](README.md)

[![CI](https://github.com/dardeaw/docgraphical/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dardeaw/docgraphical/actions/workflows/ci.yml)

個人與團隊**知識管理（Knowledge Management）平台**：把散落在 PDF / PPT / Word / Markdown 裡的知識，變成可累積、可引用、可對話的確定性知識庫。地基是確定性 Markdown AST 解析與精準切片引擎；上層是文件入庫管線、3D 知識地圖、MCP 工具、以原文切片為根據的 AI 對話面板，以及掌管每一次 LLM 呼叫的提示詞管理。

> 路線主檔：[`PLAN.zh-TW.md`](PLAN.zh-TW.md)（KM Master Plan，含四條教條、目標架構、Phase 0–5）。

---

## 為什麼是知識管理，而不是 RAG

傳統 RAG 每次查詢都從原始文件重新推導、毫無累積；向量切分還會切斷標題階層與程式碼區塊，讀到的是有損碎片。DocGraphical 走另一條路（參照 Andrej Karpathy《LLM Wiki》構想並修正其最脆弱的一環）：

| 維度 | Karpathy LLM Wiki | DocGraphical |
|---|---|---|
| 知識累積 | LLM 手工維護 wiki 散文層 | **代碼寫索引**（parser／scanner／SQLite），可重現 |
| 檢索方式 | LLM 讀合成散文（有損中間人） | **CPU 確定性定位**：heading path＋行號，零 token、零模糊 |
| 引用粒度 | 頁級連結 | **標題級＋字元／行號偏移** |
| 失效模式 | 靜默腐壞（故需 lint） | 結構性失敗大聲報錯；快取層指紋失效重算 |
| LLM 角色 | 擁有並維護知識 | **只讀被人類確認的原文切片** |

一句話：**CPU 決定讀哪幾刀，LLM 只把這幾刀讀成答案**——不選料、不記憶、不維護。

---

## 四條教條（全站鐵律）

1. **先定位（CPU），後閱讀（LLM）**——檢索主體是確定性代碼，LLM 不參與「找」，只參與「讀」。
2. **原文餵讀**——LLM 讀的是被命中的原文切片，不存在有損中間人。
3. **合成也是切片聚合**——跨文件綜合題＝search 聚合 N 個精準切片→一次讀完作答，附 N 個出處。
4. **命中由人終審**——問／逛（CPU 搜）→看命中（人眼判定）→確認（人的開關）→讀原檔（此刻才燒算力）。

---

## 現在能用什麼

### 文件入庫管線（Explorer 右鍵 → ＋新增文件…）
- Office／PDF **拖拉上傳**（ppt／pptx／doc／docx／pdf），暫存等待確認，Confirm 才與摘要一起寫入目標目錄
- **一鍵摘要**：上傳→LLM 摘要→預覽／編輯→確認，全程自動串接；檔名自動跟隨
- **圖片型文件開眼**：零文字的掃描 PDF／圖片 PPT 自動轉走 vision 模型看圖摘要（需 vision 模型，如 gpt-5 系列）
- 摘要 md 與原檔**並存同目錄**，header 強制記錄來源相對路徑，存檔即增量索引
- 加密 PDF／損毀檔／舊版二進位給人話錯誤訊息，不整批陪葬

### 知識樹（Explorer）
- project／folder／md／heading 四層，長檔名截斷＋hover 全名，file count 徽章
- folder 列 inline **＋**（新增文件）／md 列 inline **−**（刪 md＋來源＋索引，需確認框）
- 右鍵選單：新增文件、**新增資料夾**（空目錄亦可見）、複製絕對路徑、圖上定位、同步
- **Source 開關**（預設開）：每個來源檔掛在自己的 md 底下；沒被任何 md 記載的孤兒檔不顯示
- 篩選框即時過濾（含祖先展開）、Sync all 增量同步、空 repo 自動引導

### md 瀏覽器
- 來源檔行是**可點超連結**（pdf inline 渲染、office 下載），右鍵選單：複製選取／複製本節／複製給 Agent／開啟來源／複製來源路徑
- 全區可拖選＋Ctrl+C；heading 點選＝真切片（右上節省徽章是實數），404／幽靈節點誠實提示

### 確定性地基（維持不變）
- `parser.py`（AST／狀態機，程式碼圍欄保護）、`scanner.py`（遍歷／關聯）、`db.py`（SQLite 索引）
- MCP stdio 五工具：`toc／section／search／graph／index`，供外部 agent 使用
- REST API：`/api/browse`＋`/api/browse/mkdir`、`/api/ingest/{upload,summarize,save,delete,source}`、`/api/sync*`、`/api/doc/section`（切片＋`full_chars` 真分母）
- 3D 知識地圖（screen-space 飛行、極點保護）、Electron 副本與 Web 版 byte 級同步

### 概念層（探礦 Prospect＋順藤 Vine）——v1.5.0
- **雙礦工、同一池**：探礦（全庫頻次：mtime 指紋快取的 DF/TF 重算，每輪一次 LLM 評審）與順藤（使用者種子＋DFS 棧行走，每 5 檔併一批判）只提名候選；**人按轉正之前，一字不落檔**
- **先暫存、再由人裁**：候選帶檔／段證據積在 `staged_items`；底稿審核頁掛預覽橫幅＋虛線預覽（轉正後標籤行的原樣）；轉正寫內文連結＋段落標籤行＋`tags/<名>.md`，移除／黑名單永不寫檔
- **生產環境驗證過的護欄**：逐通 `max_completion_tokens` 配額（gpt-5 系列送舊名 `max_tokens` 會 400）、150 秒總時限硬殺＋熔斷重排（超時退回重判一次，連跪兩次才跳過）、LIFO 取排水栓修復、逐段計時 trace
- **檢視器翻頁**：瀏覽器式上一頁／下一頁（文件、段落、標籤頁、底稿頁全記），還原走同一選取入口（左樹＋3D＋檢視器連動）
- REST API：`/api/concepts/scan*`（挖／審／收／黑名單）、`/api/crawl/{start,next,finish,confirm,refresh}`（runs 駐 server 記憶體）、`/api/concepts/candidates/draft`（證據分組）

### 文件入庫與知識拓撲滾動複利 (Ingest & Compound Ingest)——v3.0.1
- **全格式多渠道輸入**：
  - **檔案拖拉支援**：PDF、PowerPoint (`.ppt`, `.pptx`)、Word (`.doc`, `.docx`)、試算表 (`.csv`)、網頁檔 (`.html`, `.htm`)、郵件 (`.eml`) 及純文字 (`.txt`, `.md`)。
  - **一鍵網頁爬取入庫 (Web Crawl)**：支援直接輸入 HTTP/HTTPS 網址，自動抓取目標網頁 HTML、智慧清洗廣告/導航/腳本，抽取純淨內文與標題並一鍵轉換為結構化知識庫 Markdown。
  - **圖文混合多模態摘要 (Hybrid Multimodal Ingest)**：支援「剪貼簿文字／純文字檔案」搭配「本機圖片／網頁截圖」同時送審。透過 Vision 視覺大模型同步理解圖表背板與文字脈絡，自動將關鍵圖片以相對路徑語法插入摘要 Markdown 內，完美還原圖文並茂的技術筆記。
- **Pass-2 知識滾動複利 (Compound Ingest)**：
  - 文件攝入生成摘要時，系統自動發動第二階段概念比對，自動提取與當前知識庫拓撲吻合的「已收錄概念」與「新發掘候選術語」，並以互動膠囊牌即時供人審勾選／剔除，自動將官方概念轉化為雙向實體連結。
- **內嵌圖片與附件檢索索引**：
  - 爬蟲與檢索引擎自動解析 Markdown 內之 `![Alt Text](Path)` 圖片標籤與附件檔名，納入索引範圍；AI 知識對話面板自動感知當前文檔之所有附件清單，杜絕「圖在眼前卻查無資料」的盲區。

### 文庫體檢與治理 (Linting & Governance)——v3.0.1
- **毫秒級輕量確定性體檢**：獨立 Linting 治理抽屜，點擊即可對知識庫執行完整健檢評分（Health Score 0-100）。
- **五大結構檢驗項目**：孤兒文件（Orphan Docs）、斷鏈壞死連結（Broken Links）、死循環引用、空章節、以及未收錄/過期之概念定義。
- **一鍵直達修復**：直接列出問題檔案行號，點擊即可跳轉 Markdown 檢視器與 3D 節點定位。

### 提示詞管理與全站國際化——v3.0.0
- **提示詞客製化中心**：提供獨立提示詞抽屜面板，完整支援概念發掘、順藤摸瓜（起點帶路／逐檔提取／整輪終審）與文件攝入（純文字／多模態視覺）提示詞之即時修改與保存。
- **分類標籤頁與即時搜尋**：提供頂部情境分類頁籤（全部、概念發掘、順藤摸瓜、文件攝入），並與內文／Key 即時關鍵字搜尋框深度聯動。
- **範本預覽與安全還原**：還原預設提示詞時跳出賽博風格確認框，完整預覽預設範本內容，徹底杜絕瀏覽器原生彈窗。
- **跨作業系統之系統語系自動偵測**：首次開啟自動讀取 Windows、macOS 與 Linux 系統或瀏覽器預設語系（繁體中文、English、日本語），並自動支援 localStorage 偏好記憶。
- **全站元件完整多語系化**：頂部工具列、3D 操控說明、AST 語法層級、關聯過濾器、操作確認對話框全面實現百分之百多語系動態切換。

### AI 對話知識檢索——v3.0.0
- **問知識庫，不是問向量庫**：浮動對話面板透過 DocGraphical 自家的 MCP 工具作答——`docgraphical_search` 全庫探索、`docgraphical_toc`＋`docgraphical_section` 精準切片、`docgraphical_graph` 結構脈絡。答案一律由原文切片組裝，沒有向量嵌入、沒有模糊語義檢索。
- **有界的工具迴圈、串流輸出**：每輪最多五個工具回合，以 SSE（`POST /api/chat`）串流到瀏覽器，事件分型為 `tool_call`、`tool_result`、`delta`、`citation`、`done`、`error`。
- **可跳轉的出處錨點**：每項結論都帶 `[[檔名#章節]]`，前端轉為可點擊錨點，一鍵在檢視器開啟該章節並在 3D 地圖定位。
- **帶脈絡、只讀不寫**：目前開啟的文件會作為對話脈絡；工具迴圈只能讀（搜尋／目錄／切片／圖譜），永不寫入知識庫，人審閘完整保留。
- **全站共用 LLM 供應商**：對話沿用與攝入、探礦相同的使用中供應商（OpenAI 相容，金鑰存於伺服器端）；未設定時在對話中明確報錯，不會靜默失敗。

### 持續整合與自動發佈——v3.0.0
- **CI 閘門**：`.github/workflows/ci.yml` 對 `docgraph`、`docgraphical` 兩個套件做靜態檢查、前端 bundle 語法檢查，並在 Linux／Windows／macOS 上以 Python 3.9–3.12 跑 `pytest`。
- **推 tag 即發佈**：`.github/workflows/release.yml` 在每個 `v*` tag 建置 sdist／wheel、從 `CHANGELOG.md` 抽出該版段落作為 release 說明，並附上產物自動發佈 GitHub Release——不再手動上傳。

---

## 目標架構

```text
DocGraphical Web（知識管理介面）
[3D 知識地圖] [TOC 閱讀] [候選命中清單] [AI 對話面板] ← 已上線（v3.0.0）
              ↑ 教條四：人審閘（跟這段對話）
對話後端＝工具迴圈（已上線：search／toc／section／graph，只讀）
MCP 知識層（既有：toc／section／search／graph／index）
確定性地基（既有：parser／scanner／db）
原始文件（不可變 raw 層：md／pdf／ppt／word）
```

---

## 路線圖（詳見 PLAN 第七節）

| Phase | 內容 | 狀態 |
|---|---|---|
| Phase 0 前置決策 | LLM 端點（O1）、硬連結語意（O4）、知識庫位置（O5） | 待拍板 |
| Phase 1 多格式 Ingest（M5） | CPU 抽取→LLM 摘要→入庫→重掃；Web 對話框已落地 | 進行中 |
| Phase 2 對話後端（M1） | `/api/chat` SSE＋工具迴圈＋人審閘 | 已完成（v3.0.0） |
| Phase 3 Chat UI（M2＋M3） | 跟這段對話、候選清單、串流面板、出處跳轉 | 已完成（v3.0.0） |
| Phase 4 切片聚合問答 | 跨文件 search→聚合→一次讀答（教條三） | 未開始 |
| Phase 5 wiki 快取層（M4，二期） | 答案存回＋指紋失效＋lint-lite | 二期 |

**明確不做**：向量嵌入／模糊語義檢索、LLM 常駐維護的散文真相層、全庫自動 RAG 問答、急於發佈 GitHub。

---

## 安裝指南

### Python 套件（CLI 與函式庫）

```bash
# 基礎安裝
pip install docgraphical

# 包含 MCP 伺服器支援
pip install "docgraphical[mcp]"
```

### Node.js 與桌面端應用

```bash
# 透過 npm 全域安裝 CLI
npm install -g docgraphical

# 本地啟動桌面版 Studio
git clone https://github.com/dardeaw/docgraphical.git
cd docgraphical && npm install && npm run start
```

---

## 快速上手（CLI 命令行工具）

### 1. 提取大綱目錄（TOC）

```bash
# 提取 Markdown 文件的階層大綱（含行號）
docg toc docs/spec.md

# 或使用簡稱：
docg t docs/spec.md
```

**輸出範例**：

```text
# TOC: docs/spec.md

- [H1] 1. 儲存子系統 (L1)
  - [H2] 1.1 LSM-Tree 架構 (L15)
    - [H3] 1.1.1 寫入路徑 (L23)
  - [H2] 1.2 讀取路徑 (L45)
```

### 2. 精準截取特定章節（Section Slice）

```bash
# 截取單一章節（含子章節）
docg slice docs/spec.md --heading "1.1 LSM-Tree 架構"

# 包含子章節與程式碼區塊
docg slice docs/spec.md --heading "1. 儲存子系統" --sub
```

### 3. 全文件關鍵字精準檢索

```bash
# 跨文件搜尋（回傳 heading path + 行號）
docg search ./docs --query "LSM-Tree"
```

### 4. 建置專案知識圖譜索引

```bash
# 掃描目錄並建置 SQLite 索引（含跨文件連結）
docg index ./docs
```

### 5. 啟動 Web 工作站與 3D 知識星系

```bash
# 啟動 Flask + WebGL 工作站（預設 http://127.0.0.1:5002）
python -m docgraphical.server
```

---

## 3D 視覺化知識地圖

基於 WebGL Force-Directed Graph 打造的工作站：視圖插槽對調（文件↔3D）、近祖置中聚焦、動態牌位看板、screen-space 飛行操作（E 升／Q 降）、 blur 自動清鍵。地圖上的每個節點都可跳回原文對應行。

---

## Model Context Protocol (MCP) 整合

### 設定方式 (`mcp_config.json` / Claude Desktop / Cursor / Antigravity)

```json
{
  "mcpServers": {
    "docgraphical": {
      "command": "python",
      "args": ["-m", "docgraphical.mcp_server"],
      "cwd": "/path/to/your/docs"
    }
  }
}
```

### 支援之 MCP 工具列表

| 工具 | 功能描述 |
| :--- | :--- |
| `docgraphical_toc` | 提取文件階層大綱 |
| `docgraphical_section` | 精準切片指定章節 |
| `docgraphical_search` | 關鍵字檢索（heading path＋行號） |
| `docgraphical_graph` | 查詢知識圖譜關聯 |
| `docgraphical_index` | 建置／更新索引 |

---

## Python API 呼叫範例

```python
from docgraphical.parser import parse_headings, extract_toc, extract_section, search_file

# 1. 解析 AST 標題列表
headings = parse_headings("docs/spec.md")
for h in headings:
    print(f"L{h['line']} [{h['level']}] {h['title']}")

# 2. 提取 TOC 大綱
toc_text = extract_toc("docs/spec.md", output_format="text")
print(toc_text)

# 3. 精準切片目標章節
section_content = extract_section("docs/spec.md", target_heading="1. 儲存子系統")
print(section_content)

# 4. 搜尋檔案內容
matches = search_file("docs/spec.md", query="LSM-Tree")
for m in matches:
    print(f"Line {m['line']}: {m['content']}")
```

---

## Node.js API 呼叫範例

```javascript
const { parseHeadings, extractToc, extractSection, searchDoc } = require('docgraphical');

// 1. 提取大綱
const toc = extractToc('docs/spec.md');
console.log(toc);

// 2. 精準章節切片
const slice = extractSection('docs/spec.md', '1. 儲存子系統', { includeSubsections: true });
console.log(slice);
```

---

## 架構與設計原則

1. **核心零外部相依（Zero Dependencies）**：核心解析器僅使用標準庫（`re`、`sqlite3`、`pathlib`），無縫相容任何企業內部與離線隔離環境。
2. **狀態機語法分析**：逐行追蹤程式碼保護區塊（```` ``` ```` 與 `~~~`），杜絕註解符號誤判。
3. **確定性邊界計算**：依據 AST 語法樹深度精確計算行數邊界，揚棄脆弱的啟發式文字猜測。
4. **關聯圖資料庫存儲**：將檔案、H1-H6 標題與引用連結存儲於具備 B-Tree 索引的 SQLite 中，實現亞毫秒級圖譜查詢。
5. **教條優先於聰明**：任何 LLM 功能都必須通過四條教條檢查——CPU 先行、原文餵讀、切片聚合、人審終局。

---

## 開發狀態

- **v3.0.1**——知識滾動複利入庫（Pass-2 Compound Ingest 概念比對與候選勾選）、文庫體檢與治理（Linting 5 大維度健檢與評分）、圖片 Alt-Text 與附件檢索穿透。
- **v3.0.0**——AI 對話知識檢索上線（MCP 工具迴圈、SSE 串流、`[[檔名#章節]]` 出處一鍵跳檢視器＋3D 定位）、提示詞管理（分類頁籤／預覽／安全還原）、系統語系自動偵測、CI＋推 tag 自動發佈。
- **v1.5.0**——概念層上線（探礦＋順藤、暫存池、人轉正）、爬行加固（取排水栓修復、token 配額、硬時限、重排）、底稿審核 UX（預覽橫幅、白話進度、翻頁歷史）。
- Web 工作站（port 5002 主庫／5003 乾淨實例）＋ Electron 桌面副本（`app/`，byte 級同步）。
- 未決事項（O1–O5）與驗收標準見 [`PLAN.zh-TW.md`](PLAN.zh-TW.md) 第七、九節。

---

## 參與貢獻

歡迎社群參與維護與擴充。請參閱 [CONTRIBUTING.zh-TW.md](CONTRIBUTING.zh-TW.md) 了解代碼規範、測試執行與 Pull Request 流程。

---

## 授權條款

DocGraphical 採用 [MIT 授權條款](LICENSE) 釋出，允許自由用於個人與商業專案。
