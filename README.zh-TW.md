# DocGraphical

專為大型語言模型程式代理（LLM Coding Agents）、檢索增強生成（RAG）管線與大型工程規格文檔設計的確定性 Markdown 抽象語法樹（AST）解析、精準切片引擎與 3D 知識圖譜工作站。

---

## 專案緣起與核心痛點

當大型語言模型代理（如 Claude Code、Cursor、Windsurf 或 Antigravity）在解讀數千行的長篇規格書、架構設計指南或 API 文檔時，傳統工具往往直接將整份文件載入模型 Context Window。

這種全檔讀取方式在實務上面臨嚴峻挑戰：

1. **Context 額度嚴重耗損**：閱讀一份 1,500 行的規格書需消耗 10,000 至 30,000 Tokens，頻繁讀取極易導致對話上限枯竭並大幅增加推論成本。
2. **注意力稀釋（Lost in the Middle）**：上下文充斥大量非目標章節，稀釋模型對關鍵邏輯的注意力，顯著提高幻覺率。
3. **傳統切分破壞結構**：純字數或字元切分機制（Naive Splitters）經常截斷程式碼區塊（Code Fences）、數學公式與標題階層。

**DocGraphical** 透過語法樹分析提供精準切片方案：

- **大綱優先（TOC 提取）**：先提取帶有行號錨點的階層大綱（約 30～50 Tokens），讓代理在閱讀前鎖定目標段落。
- **精準章節切片（Section Slicing）**：精確截取指定標題段落及其子章節與程式碼區塊，絕不載入前後無關章節（約 100～300 Tokens）。
- **程式碼區塊保護**：確保程式碼內的註解符號（如 Python 或 Bash 的 `#`）不會被誤判為 Markdown 標題。
- **知識圖譜與跨文檔關聯**：自動解析文件間的 Markdown 引用連結，並持久化存儲於輕量級 SQLite 圖資料庫（`.docgraphical/docgraphical.db`）。
- **3D 視覺化 AST 工作站**：基於 WebGL Force-Directed Graph 打造，支援視圖插槽對調、近祖置中聚焦、動態牌位看板揭示與低調半透明星雲縱深。
- **原生支援 Model Context Protocol (MCP)**：提供標準化的 Stdio JSON-RPC 介面，無縫對接各類主流 AI 代理環境。

---

## Token 消耗效益評估

| 操作情境 | 傳統全檔讀取 | 向量切分檢索 | DocGraphical 語法切片 |
| :--- | :--- | :--- | :--- |
| **讀取 1,500 行規格書** | 約 18,000 Tokens | 約 2,500 Tokens（有損） | **約 150 Tokens** |
| **階層結構完整性** | 完整（但代價高昂） | 破碎斷裂 | **嚴格維持語法樹層級** |
| **程式碼區塊完整性** | 完整 | 頻繁遭到腰斬截斷 | **100% 完整保留** |
| **無關雜訊干擾** | 極高 | 中等 | **零無關文字** |
| **Token 節省幅度** | 0% | 約 85% | **約 97.4%** |

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
cd docgraphical
npm install
npm start
```

---

## 快速上手（CLI 命令行工具）

支援 `docgraphical` 與簡稱別名 `docg`：

### 1. 提取大綱目錄（TOC）

為任何 Markdown 檔案產生精簡且帶行號的結構大綱：

```bash
docgraphical toc docs/architecture.md
# 或使用簡稱：
docg toc docs/architecture.md
```

輸出範例：
```text
=== [DocGraphical TOC] architecture.md ===
[Line    1] # 架構總覽
[Line   24]   ## 1. 儲存子系統
[Line   58]     ### 1.1 預寫式日誌 (WAL)
[Line  112]     ### 1.2 LSM-Tree 壓實機制
[Line  180]   ## 2. 分散式共識協議
[Line  245]   ## 3. 網路傳輸層
```

亦支援輸出 JSON 格式供程式化工作流串接：
```bash
docg toc docs/architecture.md --format json
```

### 2. 精準截取特定章節（Section Slice）

精確提取指定標題內容，並在遇到同級或更高層級標題前精準停止：

```bash
docg section docs/architecture.md "1. 儲存子系統"
```

若僅需該標題本文且不包含其子章節：
```bash
docg section docs/architecture.md "1. 儲存子系統" --no-subsections
```

### 3. 全文件關鍵字精準檢索

搜尋文檔並輸出確切行號與上下文片段：

```bash
docg search docs/ "壓實機制"
```

### 4. 建置專案知識圖譜索引

掃描專案目錄，將所有 Markdown 解析為 AST 節點與跨文件關聯，存入 `.docgraphical/docgraphical.db`：

```bash
docg index .
```

### 5. 啟動 Web 工作站與 3D 知識星系

啟動本地 HTTP 伺服器並開啟視覺化檢視面板：

```bash
docg serve --port 5002
```

---

## 3D 視覺化 AST 工作站

DocGraphical 內建專為結構探索打造的高效能 3D WebGL 知識星系：

1. **Slot 插槽視圖對調**：中央 Markdown 閱讀器與右上角 3D 圖譜可在 DOM 層級無損對調，完全不破壞三欄版面比例。
2. **真·近祖置中（1-Level Parent Centering）**：選取次級章節（H2、H3、H4）時，相機自動鎖定其直屬母章節（近祖）置中，提供最舒適的層級脈絡。
3. **動態 SpriteText 牌位揭示**：浮動 3D 看板保持原生 AST 分類色彩，選取時明亮顯靈，未選取之背景節點則呈現低調半透明星雲幽影。
4. **宗族脈絡回溯高亮**：點擊深層章節時，自動向上遞迴點亮直達頂層 Document 檔案球體之整條血脈鏈路。

---

## Model Context Protocol (MCP) 整合

DocGraphical 原生支援 Model Context Protocol (MCP)，允許 AI 代理透過標準 Stdio JSON-RPC 查詢文檔結構。

### 設定方式 (`mcp_config.json` / Claude Desktop / Cursor / Antigravity)

```json
{
  "mcpServers": {
    "docgraphical": {
      "command": "python",
      "args": ["-m", "docgraphical.cli", "mcp"]
    }
  }
}
```

### 支援之 MCP 工具列表

| 工具名稱 | 參數說明 | 功能描述 |
| :--- | :--- | :--- |
| `docgraphical_toc` | `filePath` (string), `format` (text/json) | 回傳帶行號的章節大綱（約 30 Tokens）。 |
| `docgraphical_section` | `filePath` (string), `heading` (string), `includeSubsections` (bool) | 精準切片提取目標章節完整內容（約 100 Tokens）。 |
| `docgraphical_search` | `filePath` (string), `query` (string), `limit` (int) | 快速正規表達式關鍵字檢索。 |
| `docgraphical_graph` | `repoPath` (string) | 回傳 AST 節點圖譜與跨文件引用關聯。 |
| `docgraphical_index` | `repoPath` (string) | 重建並更新儲存庫之 SQLite AST 索引。 |

---

## Python API 呼叫範例

可直接於 Python 程式或自動化腳本中載入使用：

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

亦提供原生 Node.js 模組支援：

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

DocGraphical 恪遵以下核心工程原則：

1. **核心零外部相依（Zero Dependencies）**：核心解析器僅使用標準庫（`re`、`sqlite3`、`pathlib`），無縫相容任何企業內部與離線隔離環境。
2. **狀態機語法分析**：逐行追蹤程式碼保護區塊（```` ``` ```` 與 `~~~`），杜絕註解符號誤判。
3. **確定性邊界計算**：依據 AST 語法樹深度精確計算行數邊界，揚棄脆弱的啟發式文字猜測。
4. **關聯圖資料庫存儲**：將檔案、H1-H6 標題與引用連結存儲於具備 B-Tree 索引的 SQLite 中，實現亞毫秒級圖譜查詢。

---

## 參與貢獻

歡迎社群參與維護與擴充。請參閱 [CONTRIBUTING.zh-TW.md](CONTRIBUTING.zh-TW.md) 了解代碼規範、測試執行與 Pull Request 流程。

---

## 授權條款

DocGraphical 採用 [MIT 授權條款](LICENSE) 釋出，允許自由用於個人與商業專案。
