# ComicCrawler 軟體開發文件

這個目錄只保存現行軟體規格。被取代的內容直接刪除或改寫。

## Scope

適合放在這裡：

- SRS / SDD / TDD
- 高階測試情境
- credential 與識別碼契約

## Current documents

- `SRS.md`：現行產品需求與驗收邊界。
- `SDD.md`：現行系統元件、資料流與互動設計。
- `TDD.md`：長期測試策略與合併門檻。
- `TEST_SCENARIOS.md`：自動化使用情境與短步驟。
- `AUTHENTICATION_CREDENTIALS.md`：token、credential 與 runtime identifier 契約。

不適合放在這裡：

- 使用者入口文件：請放 `../../README.md`
- 使用者／貢獻者 API 與 architecture 文件：請放 `../`
- 貢獻指南：請放 `../../CONTRIBUTING.md`
- Agent 操作指引：請放 workspace root 的 `AGENTS.md`

若內容描述已移除的設計，應刪除或直接改寫現行章節。
