# DocGraphical 貢獻指南

感謝您對 DocGraphical 專案的關注與支持。我們竭誠歡迎社群貢獻，共同推動 Markdown 抽象語法樹解析、Token 節約技術與 AI 代理生態的繁榮發展。

---

## 行為準則

我們期許所有參與者在社群互動中秉持相互尊重、誠懇交流與工程嚴謹的態度。

---

## 開發環境設置

### 1. Fork 並複製儲存庫

```bash
git clone https://github.com/dardeaw/docgraphical.git
cd docgraphical
```

### 2. 配置 Python 虛擬環境

```bash
python -m venv .venv
# Windows 環境：
.venv\Scripts\activate
# Linux / macOS 環境：
source .venv/bin/activate

pip install -e ".[dev,mcp]"
```

### 3. 配置 Node.js 環境

```bash
npm install
```

### 4. 執行測試套件

所有送出的代碼修改必須 100% 通過 Python 與 Node.js 雙測試套件：

```bash
# 執行 Python 單元測試
pytest tests/

# 執行 Node.js 測試
npm test
```

---

## Pull Request 規範

1. **聚焦明確**：單一 Pull Request 請專注於單一功能、錯誤修復或效能優化。
2. **確定性保證**：語法解析必須嚴格恪守狀態機機制，嚴禁引入不確定的啟發式猜測。
3. **核心零外部相依**：核心解析函式庫嚴格禁止引入任何第三方外部依賴套件。
4. **雙語文件同步**：若涉及 CLI 參數或核心行為變更，請同步更新英文與繁體中文說明文件。

---

## 授權聲明

當您向 DocGraphical 提交代碼時，即表示您同意將該貢獻以專案之 [MIT 授權條款](LICENSE) 釋出。
