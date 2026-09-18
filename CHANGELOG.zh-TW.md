# 版本變更記錄

[繁體中文](CHANGELOG.zh-TW.md) | [English](CHANGELOG.md)

本文件記錄 DocGraphical 專案的所有重要版本演進與功能變更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，並嚴格遵循 [語意化版本 (Semantic Versioning)](https://semver.org/lang/zh-TW/) 規範。

---

## [1.0.0] - 2026-09-18

### 新增功能
- **確定性 AST 語法解析引擎**：狀態機逐行解析，嚴格隔離程式碼區塊註解。
- **精準章節切片器**：依據語法樹層級精準擷取目標章節，實測節省約 97.4% 之 Token 消耗。
- **TOC 大綱目錄萃取器**：快速產生帶有行號錨點的大綱目錄，支援純文字與 JSON 格式。
- **雙執行環境支援**：Python 3.9+ 與 Node.js 18+ 雙引擎功能完全對齊。
- **Model Context Protocol (MCP) 伺服器**：原生 Stdio JSON-RPC 2.0 伺服器，支援五大標準工具。
- **3D 視覺化 AST 工作站**：WebGL 力導向星系圖譜，具備插槽對調、真·近祖置中聚焦、SpriteText 牌位動態顯靈與低調半透明星雲縱深。
- **桌面端應用程式**：Electron 封裝與跨平台安裝包建置配置。
- **全套雙語規格文件**：提供嚴謹莊重、鉅細靡遺之英文與繁體中文全套說明文件。
