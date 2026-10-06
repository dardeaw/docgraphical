# DocGraphical

[繁體中文](README.zh-TW.md) | [English](README.md)

個人與團隊**知識管理（Knowledge Management）平台**：把散落在 PDF / PPT / Word / Markdown 裡的知識，變成可累積、可引用、可對話的確定性知識庫。地基是確定性 Markdown AST 解析與精準切片引擎；上層是文件入庫管線、3D 知識地圖、MCP 工具與（規劃中）AI 對話面板。

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

### 📥 文件入庫管線（Explorer 右鍵 → ＋新增文件…）
- Office／PDF **拖拉上傳**（ppt／pptx／doc／docx／pdf），暫存等待確認，Confirm 才與摘要一起寫入目標目錄
- **一鍵摘要**：上傳→LLM 摘要→預覽／編輯→確認，全程自動串接；檔名自動跟隨
- **圖片型文件開眼**：零文字的掃描 PDF／圖片 PPT 自動轉走 vision 模型看圖摘要（需 vision 模型，如 gpt-5 系列）
- 摘要 md 與原檔**並存同目錄**，header 強制記錄來源相對路徑，存檔即增量索引
- 加密 PDF／損毀檔／舊版二進位給人話錯誤訊息，不整批陪葬

### 🌳 知識樹（Explorer）
- project／folder／md／heading 四層，長檔名截斷＋hover 全名，file count 徽章
- folder 列 inline **＋**（新增文件）／md 列 inline **−**（刪 md＋來源＋索引，需確認框）
- 右鍵選單：新增文件、**新增資料夾**（空目錄亦可見）、複製絕對路徑、圖上定位、同步
- **👁 Source 開關**（預設開）：每個來源檔掛在自己的 md 底下；沒被任何 md 記載的孤兒檔不顯示
- 篩選框即時過濾（含祖先展開）、⚡ Sync all 增量同步、空 repo 自動引導

### 📖 md 瀏覽器
- 來源檔行是**可點超連結**（pdf inline 渲染、office 下載），右鍵選單：複製選取／複製本節／複製給 Agent／開啟來源／複製來源路徑
- 全區可拖選＋Ctrl+C；heading 點選＝真切片（右上節省徽章是實數），404／幽靈節點誠實提示

### 🗄️ 確定性地基（維持不變）
- `parser.py`（AST／狀態機，程式碼圍欄保護）、`scanner.py`（遍歷／關聯）、`db.py`（SQLite 索引）
- MCP stdio 五工具：`toc／section／search／graph／index`，供外部 agent 使用
- REST API：`/api/browse`＋`/api/browse/mkdir`、`/api/ingest/{upload,summarize,save,delete,source}`、`/api/sync*`、`/api/doc/section`（切片＋`full_chars` 真分母）
- 3D 知識地圖（screen-space 飛行、極點保護）、Electron 副本與 Web 版 byte 級同步

---

## 目標架構

```text
DocGraphical Web（知識管理介面）
[3D 知識地圖] [TOC 閱讀] [候選命中清單] [AI 對話面板] ← 規劃中
              ↑ 教條四：人審閘（跟這段對話）
對話後端＝工具迴圈（規劃中 M1：toc／section／search 三受控工具）
MCP 知識層（既有：toc／section／search／graph／index）
確定性地基（既有：parser／scanner／db）
原始文件（不可變 raw 層：md／pdf／ppt／word）
```

---

## 路線圖（詳見 PLAN 第七節）

| Phase | 內容 | 狀態 |
|---|---|---|
| Phase 0 前置決策 | LLM 端點（O1）、硬連結語意（O4）、知識庫位置（O5） | ⏳ 待拍板 |
| Phase 1 多格式 Ingest（M5） | CPU 抽取→LLM 摘要→入庫→重掃；Web 對話框已落地 | 🚧 進行中 |
| Phase 2 對話後端（M1） | `/api/chat` SSE＋工具迴圈＋人審閘 | ⬜ 未開始 |
| Phase 3 Chat UI（M2＋M3） | 跟這段對話、候選清單、串流面板、出處跳轉 | ⬜ 未開始 |
| Phase 4 切片聚合問答 | 跨文件 search→聚合→一次讀答（教條三） | ⬜ 未開始 |
| Phase 5 wiki 快取層（M4，二期） | 答案存回＋指紋失效＋lint-lite | ⬜ 二期 |

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

- 本地迭代中，**不急於發佈 GitHub**（見 PLAN 第八節）。
- Web 工作站（port 5002 主庫／5003 乾淨實例）＋ Electron 桌面副本（`app/`，byte 級同步）。
- 未決事項（O1–O5）與驗收標準見 [`PLAN.zh-TW.md`](PLAN.zh-TW.md) 第七、九節。

---

## 參與貢獻

歡迎社群參與維護與擴充。請參閱 [CONTRIBUTING.zh-TW.md](CONTRIBUTING.zh-TW.md) 了解代碼規範、測試執行與 Pull Request 流程。

---

## 授權條款

DocGraphical 採用 [MIT 授權條款](LICENSE) 釋出，允許自由用於個人與商業專案。
