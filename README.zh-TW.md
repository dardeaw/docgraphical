# DocGraph

專為 AI 程式代理（LLM Coding Agents）、RAG 檢索增強管線與工程規格文檔設計的確定性 Markdown 抽象語法樹（AST）解析與章節切片引擎。

---

## 專案緣起與核心痛點

當大型語言模型代理（如 Claude Code、Cursor、Windsurf 或 Antigravity）在解讀數千行的長篇規格書、架構設計指南或 API 文檔時，傳統工具往往直接將整份文件載入模型 Context Window。

這種全檔讀取方式在實務上面臨嚴峻挑戰：

1. **Context 額度嚴重耗損**：閱讀一份 1,500 行的規格書需消耗 10,000 至 30,000 Tokens，頻繁讀取極易導致對話上限枯竭並大幅增加推論成本。
2. **注意力稀釋（Lost in the Middle）**：上下文充斥大量非目標章節，稀釋模型對關鍵邏輯的注意力，顯著提高幻覺率。
3. **傳統切分破壞結構**：純字數或字元切分機制（Naive Splitters）經常截斷程式碼區塊（Code Fences）、數學公式與標題階層。

**DocGraph** 透過語法樹分析提供精準切片方案：

- **大綱優先（TOC 提取）**：先提取帶有行號錨點的階層大綱（約 30～50 Tokens），讓代理在閱讀前鎖定目標段落。
- **精準章節切片（Section Slicing）**：精確截取指定標題段落及其子章節與程式碼區塊，絕不載入前後無關章節（約 100～300 Tokens）。
- **程式碼區塊保護**：確保程式碼內的註解符號（如 Python 或 Bash 的 `#`）不會被誤判為 Markdown 標題。
- **知識圖譜與跨文檔關聯**：自動解析文件間的 Markdown 引用連結，並持久化存儲於輕量級 SQLite 圖資料庫（`.docgraph/docgraph.db`）。
- **原生支援 Model Context Protocol (MCP)**：提供標準化的 Stdio JSON-RPC 介面，無縫對接各類主流 AI 代理環境。

---

## Token 消耗效益評估

| 操作情境 | 傳統全檔讀取 | 向量切分檢索 | DocGraph 語法切片 |
| :--- | :--- | :--- | :--- |
| **讀取 1,500 行規格書** | ~18,000 Tokens | ~2,500 Tokens (失真) | **~150 Tokens** |
| **階層語意完整度** | 完整（消耗極高） | 碎片化 | **完整保留 AST 階層** |
| **程式碼區塊完整性** | 完整 | 經常中斷 | **保證 100% 完整** |
| **無關上下文雜訊** | 極高 | 中等 | **零無關干擾** |
| **Token 節省率** | 0% | ~85% | **~97%** |

---

## 安裝指南

### Python 套件（CLI 與核心庫）

```bash
# 基本安裝
pip install docgraph

# 包含 MCP 伺服器支援
pip install "docgraph[mcp]"
```

### Node.js / 桌面應用程式

```bash
# 全域 CLI
npm install -g docgraph

# 本地運行桌面應用程式
git clone https://github.com/dardeaw/docgraph.git
cd docgraph
npm install
npm start
```

---

## 快速上手（CLI）

### 1. 提取目錄大綱（TOC）

快速輸出精確行號階層：

```bash
docgraph toc docs/architecture.md
```

輸出範例：
```text
=== [DocGraph TOC] architecture.md ===
[Line    1] # 系統架構總覽
[Line   24]   ## 1. 儲存子系統
[Line   58]     ### 1.1 WAL 預寫日誌
[Line  112]     ### 1.2 LSM-Tree 壓縮機制
[Line  180]   ## 2. 分散式共識協定
[Line  245]   ## 3. 網路傳輸層
```

支援輸出 JSON 格式供程式解析：
```bash
docgraph toc docs/architecture.md --format json
```

### 2. 精準切片指定章節

僅提取目標章節，於同級或更高級標題處精確截斷：

```bash
docgraph section docs/architecture.md "1. 儲存子系統"
```

若僅需該標題正文、不含子章節：
```bash
docgraph section docs/architecture.md "1. 儲存子系統" --no-subsections
```

### 3. 跨文檔關鍵字檢索

輸出精確行號與上下文片段：

```bash
docgraph search docs/ "LSM-Tree"
```

### 4. 建立專案知識圖譜

掃描目錄、解析 Markdown AST 節點與跨文檔連結，寫入 `.docgraph/docgraph.db`：

```bash
docgraph index .
```

### 5. 啟動視覺化工作站（Web Studio）

```bash
docgraph serve --port 5002
```

---

## Model Context Protocol (MCP) 設定

DocGraph 原生支援 MCP 協定，可透過標準 Stdio 與 AI 代理通訊。

### 設定檔範例 (`mcp_config.json` / Claude Desktop / Cursor / Antigravity)

```json
{
  "mcpServers": {
    "docgraph": {
      "command": "python",
      "args": ["-m", "docgraph.cli", "mcp"]
    }
  }
}
```

### MCP 工具清單

| 工具名稱 | 參數 | 說明 |
| :--- | :--- | :--- |
| `docgraph_toc` | `filePath` (string), `format` (text/json) | 提取標題階層大綱與行號錨點（約 30 Tokens）。 |
| `docgraph_section` | `filePath` (string), `heading` (string), `includeSubsections` (bool) | 精確提取指定段落原文（約 100 Tokens）。 |
| `docgraph_search` | `filePath` (string), `query` (string), `limit` (int) | 快速搜尋指定檔案或目錄內之關鍵字。 |
| `docgraph_graph` | `repoPath` (string) | 查詢知識圖譜節點與跨文檔連結關聯。 |
| `docgraph_index` | `repoPath` (string) | 重建並更新指定專案之 SQLite AST 索引。 |

---

## Python API 使用範例

```python
from docgraph.parser import parse_headings, extract_toc, extract_section, search_file

# 1. 解析 AST 標題清單
headings = parse_headings("docs/spec.md")
for h in headings:
    print(f"L{h['line']} [{h['level']}] {h['title']}")

# 2. 提取大綱文字
toc_text = extract_toc("docs/spec.md", output_format="text")
print(toc_text)

# 3. 精確截取章節內容
content = extract_section("docs/spec.md", target_heading="1. 儲存子系統")
print(content)
```

---

## 架構與設計原則

1. **核心零第三方執行時期依賴**：核心解析器與掃描器僅使用 Python 標準庫（`re`、`sqlite3`、`pathlib`），無任何第三方套件依賴，適應各類隔離或封閉環境。
2. **狀態機解析機制**：採用逐行狀態機嚴格追蹤程式碼區塊（```` ``` ```` 與 `~~~`），徹底杜絕程式碼內註解符號之誤判。
3. **確定性邊界計算**：依據 AST 標題深度嚴格計算起訖行號，而非依賴不穩定的啟發式字串比對。
4. **關聯式圖譜儲存**：節點（文件、H1~H6）與邊（包含關係、Markdown 超連結）均經 B-Tree 索引儲存於 SQLite，提供毫秒級檢索。

---

## 授權條款

DocGraph 基於 [MIT License](LICENSE) 授權開源。
