# DocGraphical 系統架構規格說明書

[繁體中文](ARCHITECTURE.zh-TW.md) | [English](ARCHITECTURE.md)

本文件詳盡闡述 DocGraphical 之內部軟體架構、語法解析狀態機演算法、資料模型與元件交互設計。

---

## 系統總體架構

DocGraphical 採用分層模組化架構，以確保高吞吐量、確定性解析與極低系統資源耗用。

```text
+-------------------------------------------------------------------+
|                         客戶端與交互層                            |
|  [CLI (docg)]  [MCP Stdio Server]  [Web Studio]  [Electron App]   |
+-------------------------------------------------------------------+
                                  |
+-------------------------------------------------------------------+
|                         核心 API 業務層                           |
|       parser.py        scanner.py        db.py        server.py   |
+-------------------------------------------------------------------+
                                  |
+-------------------------------------------------------------------+
|                     確定性 AST 語法樹引擎                         |
|  - 狀態機程式碼保護區塊隔離機制 (Fenced Code Block Tracking)        |
|  - 嚴格行號錨點索引 (1-based Line Anchoring)                      |
|  - 確定性子樹邊界解析演算法 (Surgical Subtree Resolution)          |
+-------------------------------------------------------------------+
                                  |
+-------------------------------------------------------------------+
|                     持久化與知識圖譜儲存層                        |
|           SQLite 資料庫 (.docgraphical/docgraphical.db)           |
|     [AST 節點表]       [跨文件引用關係表]       [B-Tree 高速索引]  |
+-------------------------------------------------------------------+
```

---

## 核心元件職責分工

### 1. 語法解析引擎 (`docgraphical/parser.py`)
- **狀態機機制**：逐行追蹤 Markdown 語法狀態，徹底隔離程式碼區塊中的 `#` 註解。
- **標題萃取器**：精準擷取 ATX（`#`）與 Setext（`===`、`---`）標題，生成 1-based 行號錨點。
- **精準切片器**：計算目標章節之閉合區間 `[StartLine, EndLine)`，直接切取目標本文。

### 2. 掃描器與圖譜建置器 (`docgraphical/scanner.py`)
- **專案遍歷**：遞迴掃描目錄，嚴格遵循 `.gitignore` 與預設忽略規則。
- **關聯提取**：解析文件間的超連結引用（`[名稱](路徑.md#章節)`）與 Wiki-Link（`[[目標]]`）。
- **AST 拓撲生成**：建構 Document 根節點至一級章節（H1）及次級章節（H2-H6）之母子包含樹。

### 3. 資料庫持久層 (`docgraphical/db.py`)
- 維護 `.docgraphical/docgraphical.db` 連線生命週期與版本遷移。
- 提供參數化 SQL 查詢介面，支援節點檢索、關聯遍歷與全文關鍵字索引。

### 4. Model Context Protocol 伺服器 (`docgraphical/mcp_server.py`)
- 實作基於 `stdin`/`stdout` 之 JSON-RPC 2.0 協定通訊。
- 暴露五大標準工具：`docgraphical_toc`、`docgraphical_section`、`docgraphical_search`、`docgraphical_graph` 與 `docgraphical_index`。

### 5. 視覺化工作站 (`static/docgraph.js`, `templates/index.html`)
- 基於 Three.js 驅動 3D WebGL 力導向知識星系。
- 支援 DOM 插槽無損對調、真·近祖置中聚焦演算法與 SpriteText 3D 浮動看板動態顯靈機制。

---

## 確定性章節切片演算法規格

章節切片演算保證極致精準度，其執行邏輯如下：

1. **文檔標記化**：解析檔案產生有序之標題語法節點集合：
   $$\mathcal{H} = \{ (l_1, d_1, t_1), (l_2, d_2, t_2), \dots, (l_n, d_n, t_n) \}$$
   其中 $l_i$ 為起始行號，$d_i \in [1, 6]$ 為標題深度層級，$t_i$ 為正規化後之標題文字。

2. **定位目標錨點**：檢索索引 $k$ 使得 $t_k = 	ext{TargetTitle}$。

3. **邊界計算**：
   - 起始行號 $	ext{StartLine} = l_k$
   - 若 `includeSubsections = True`：搜尋目標後方首個滿足 $d_j \le d_k$ 之標題 $j > k$。
     $$	ext{EndLine} = egin{cases} l_j - 1 & 	ext{若存在該 } j \ 	ext{檔案總行數} & 	ext{若不存在後續同級或更高層級標題} \end{cases}$$
   - 若 `includeSubsections = False`：直接以相鄰之下一個標題 $j = k + 1$ 作為截止線。
     $$	ext{EndLine} = egin{cases} l_{k+1} - 1 & 	ext{若 } k+1 \le n \ 	ext{檔案總行數} & 	ext{若已達文檔末尾} \end{cases}$$

4. **原樣切片提取**：直接截取區間 $	ext{Lines}[	ext{StartLine} : 	ext{EndLine}]$，無任何有損重編碼。
