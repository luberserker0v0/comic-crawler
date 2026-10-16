# ComicCrawler 軟體需求規格

## 1. 目的與範圍

ComicCrawler 是 adapter-based 漫畫爬蟲服務。Server 提供 REST API、WebUI、工作排程、adapter 管理與持久化；使用者端 Browser Provider 提供 Playwright browser runtime。Server 不在容器內啟動瀏覽器。

本文件只定義現行產品需求。操作方式見 [User Guide](../USER_GUIDE.md)，公開 API 見 [API](../API.md) 與 [OpenAPI](../openapi.yaml)，詳細設計見 [SDD](SDD.md)。

## 2. 角色

| 角色 | 責任 |
|---|---|
| 使用者 | 建立爬蟲工作、選擇 Browser Worker、處理人工驗證 |
| 開發者 | 審核 adapter、維護 fixture、執行測試 |
| 管理者 | 部署 Server、設定 API security policy 與 secrets |
| Browser Provider | 在使用者端建立短生命週期 Playwright session |
| AO service | 選用；產生待審核的 adapter implementation draft |

## 3. 系統邊界

1. ComicCrawler Server 管理 API、工作、排程、adapter、狀態與下載檔案。
2. Browser Provider 由使用者端主動連線 Server。
3. Browser Provider 不開放 inbound port。
4. Chromium 與 profile 位於使用者端。
5. AO service 只參與 adapter discovery。
6. 漫畫圖片下載由 Server 依已擷取 URL 執行。

## 4. 功能需求

### 4.1 Adapter

- **ADP-001**：系統必須依 URL 與所需 capability 選擇 adapter。
- **ADP-002**：所有 adapter 必須使用 `parseMode: playwright`。
- **ADP-003**：adapter capability 分為 verification、metadata 與 chapter images。
- **ADP-004**：特定章節工作只要求 chapter-images capability。
- **ADP-005**：全章節工作要求 metadata 與 chapter-images capability。
- **ADP-006**：Adapter Lab 必須能編輯及執行 project-source、generated TypeScript 與 selector manifest draft。
- **ADP-007**：產生的 adapter 必須經開發者審核後才能發布。
- **ADP-008**：發布 adapter 前必須透過 Browser Provider 擷取頁面並保存 fixture 與 expected result。
- **ADP-009**：刪除的 adapter 不得在重啟後自動恢復。

### 4.2 Chapter image API

- **IMG-001**：chapter-images API 必須回傳完整且有序的圖片 URL。
- **IMG-002**：`imageUrlCount` 必須等於 `imageUrls.length`。
- **IMG-003**：呼叫端可以指定 viewport width、height 與 device scale factor。
- **IMG-004**：viewport 使用 CSS pixels。
- **IMG-005**：未指定 render context 時使用 `1920 × 1080` 與 scale `1`。
- **IMG-006**：回應必須包含實際使用的 render context。
- **IMG-007**：同一 adapter 的並行測試不得交叉使用 renderer 或 viewport。
- **IMG-008**：手機 viewport 必須能觸發依尺寸切換的 responsive DOM。
- **IMG-009**：系統不宣稱 viewport 等同完整手機裝置模擬。

### 4.3 爬蟲工作

- **CRL-001**：使用者可以建立特定章節或全章節工作。
- **CRL-002**：工作必須綁定指定 Browser Worker，或使用 `any` 讓 scheduler 選擇。
- **CRL-003**：工作開始後必須維持 worker affinity。
- **CRL-004**：若沒有符合條件的 idle Worker，工作必須等待至逾時。
- **CRL-005**：每個 Browser Worker 第一版一次只能執行一個工作。
- **CRL-006**：Server 必須保存章節、圖片與下載 checkpoint。
- **CRL-007**：恢復工作時必須跳過已完成項目。
- **CRL-008**：工作結果必須記錄成功、失敗與輸出位置。

### 4.4 Browser Provider

- **BP-001**：Provider 必須先透過 discovery API 取得註冊與 WebSocket endpoint。
- **BP-002**：Provider 必須以 user ID 與 user token 註冊。
- **BP-003**：Server 必須依 security policy 決定是否接受註冊。
- **BP-004**：成功註冊後 Server 必須核發獨立 provider credential。
- **BP-005**：Provider 必須使用 credential 建立 outbound control WebSocket。
- **BP-006**：Playwright protocol 必須透過 outbound reverse relay WebSocket 傳輸。
- **BP-007**：同一 user ID 可以擁有多個同時在線的 Provider／Worker。
- **BP-008**：Server 必須以 process instance ID 防止舊連線錯誤恢復。
- **BP-009**：Provider 必須為每個 session 建立臨時 profile。
- **BP-010**：session 結束時必須關閉 browser 並清理臨時 profile。
- **BP-011**：Provider process 結束後不保證 session 存續。

### 4.5 Browser lease 與 handoff

- **LEASE-001**：browser-backed operation 必須先取得 task-scoped Worker lease。
- **LEASE-002**：lease 建立 Playwright session 並定期續約。
- **LEASE-003**：正常完成、取消或失敗時必須釋放 lease 與 session。
- **LEASE-004**：等待人工驗證時必須釋放 scheduler slot，但保留 Worker lease。
- **LEASE-005**：handoff 必須沿用原 Worker 與 browser session。
- **LEASE-006**：不得將指定 Worker 靜默替換成其他裝置。
- **LEASE-007**：handoff 遺失時必須提供可理解的恢復動作。

### 4.6 Scheduler

- **SCH-001**：爬蟲工作與 adapter 工作必須由共用 scheduler 管理。
- **SCH-002**：scheduling policy 必須可替換。
- **SCH-003**：系統必須提供 sequential 與 concurrent policy。
- **SCH-004**：等待 Worker、人工驗證或開發者審核不得占用 execution slot。
- **SCH-005**：adapter discovery 同一 hostname 同時只能有一個 active build。

### 4.7 Adapter discovery

- **DISC-001**：未知站點或 capability mismatch 必須建立 discovery 工作。
- **DISC-002**：discovery 可以使用遠端頁面、已驗證頁面或 HTML snapshot。
- **DISC-003**：Agent-facing task 與結果必須使用 Markdown，不要求 Agent 讀寫 JSON contract。
- **DISC-004**：chapter-only discovery 必須產生 chapter-images capability draft。
- **DISC-005**：full discovery 必須產生 metadata 與 chapter-images capability draft。
- **DISC-006**：draft 在發布前必須通過型別、結構、fixture 與人工審核 gate。

### 4.8 API security

- **SEC-001**：Server 必須支援 `public` 與 `token` mode。
- **SEC-002**：token mode 必須依 user、role、permission 與 policy rule 授權。
- **SEC-003**：user token 只用於 user-facing REST API。
- **SEC-004**：provider credential 只用於其 Provider 的 control／relay connection。
- **SEC-005**：provider credential 必須可 rotation 與 revoke。
- **SEC-006**：Provider、Worker、lease 與 handoff 操作必須檢查 owner。
- **SEC-007**：log 不得包含 user token、provider credential 或 provider options。

### 4.9 WebUI 與 API

- **WEB-001**：WebUI 必須支援工作建立、工作詳情、handoff、adapter review 與設定。
- **WEB-002**：WebUI 必須列出目前使用者可見的 Browser Worker。
- **WEB-003**：API 必須以 REST resource 表示工作、adapter、Provider、Worker 與 handoff。
- **WEB-004**：WebSocket 事件只提供即時更新，不取代可查詢的 REST 狀態。
- **WEB-005**：公開 API 必須由 OpenAPI 文件描述。

## 5. 非功能需求

### 5.1 可靠性

1. Server process 存活期間必須維持 Worker connection 與 lease 狀態一致。
2. Provider 斷線時，相關 operation 必須失敗或等待，不得改用未知 Worker。
3. Server 重啟後必須恢復持久化工作與 checkpoint。
4. Runtime data 必須只從設定的 data root 載入。

### 5.2 安全

1. Cloud deployment 必須使用 HTTPS／WSS。
2. Secret document 不得提交至版本控制。
3. Provider credential 必須以 bearer credential 傳輸。
4. private-network URL 存取必須受 SSRF policy 限制。

### 5.3 可維護性

1. shared package 定義跨 workspace API types。
2. Browser lifecycle 由 Strategy abstraction 管理。
3. Browser Provider protocol 由 SDK 封裝。
4. scheduler 行為由 policy abstraction 管理。
5. 文件只描述現行契約。

### 5.4 Runtime defaults

| 項目 | 預設值 |
|---|---:|
| Backend | `127.0.0.1:4100` |
| Frontend dev server | `5173` |
| Default viewport | `1920 × 1080` |
| Default device scale factor | `1` |
| Worker task capacity | `1` |

## 6. 驗收依據

1. [OpenAPI](../openapi.yaml) 與實際 API 一致。
2. [TDD](TDD.md) 定義的 build、typecheck、unit、integration 與 E2E gate 通過。
3. [Test Scenarios](TEST_SCENARIOS.md) 的現行情境有對應自動化測試。
4. [Architecture](../ARCHITECTURE.md) 與 [SDD](SDD.md) 使用相同元件與術語。
