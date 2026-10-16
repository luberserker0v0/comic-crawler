# ComicCrawler 測試策略

## 1. 目的

本文件定義長期有效的測試分層與合併門檻。測試數量、coverage 百分比與單次執行結果由 CI／test runner 提供，不寫入規格文件。

## 2. 測試原則

1. Unit test 驗證單一 class、policy、validator 或 adapter capability。
2. Integration test 驗證多個 backend component 與 storage 邊界。
3. E2E test 驗證 REST、WebUI、Browser Provider relay 與 Playwright。
4. 真實網站只用於人工 smoke，不作為可重現的 CI oracle。
5. Adapter fixture 必須由已審核頁面產生。
6. 同一測試只描述一個主要結果。
7. 步驟過多時拆成多個案例。
8. 測試名稱使用 `AREA-NN 簡短行為`。

## 3. 測試層級

### 3.1 Unit

範圍：

- Adapter URL matching 與 extraction。
- Render context validation。
- Browser Provider registry 與 lease coordinator。
- Scheduler policy 與 lifecycle。
- API security policy。
- Challenge detection 與 handoff state。
- Selector discovery validation。
- Storage、checkpoint 與 error mapping。

命令：

```bash
npm run -w backend test -- --runInBand
npm run -w frontend test -- --runInBand
npm run -w browser-provider-sdk test
```

### 3.2 Integration

範圍：

- REST-only task flow。
- Task manager、scheduler、crawler 與 storage。
- Download 與 checkpoint resume。
- Provider ownership 與 session routing。
- Fixture capture、replay 與 promotion gate。

Integration tests 與 backend Jest suite 一起執行。

### 3.3 E2E

E2E 啟動完整 backend、production frontend assets、Browser Provider SDK client、reverse relay 與 Playwright browser。

範圍：

- Task creation 與 task detail。
- Adapter discovery、review、publish 與 crawl。
- Browser Worker selection 與 lease lifecycle。
- Human verification handoff 與 resume。
- Responsive mobile／desktop chapter extraction。
- WebUI error 與 recovery state。

命令：

```bash
npm run build
npm run -w backend test:e2e
```

## 4. Fixture policy

1. 開發者在 Adapter Lab 審核 draft。
2. 開發者按下接受。
3. Server 使用選定 Browser Worker 取得 rendered page。
4. Server 保存 `page.html`。
5. Server 保存 `expected.json`。
6. Test 以 fixture replay 驗證 adapter。
7. Fixture gate 通過後才發布 adapter。

Fixture 不應包含 token、credential、authorization header 或個人資料。

## 5. Browser 與 concurrency 測試

### 5.1 Worker lease

必須驗證：

1. Idle Worker 可以取得 lease。
2. Busy Worker 不接受第二個工作。
3. `any` 只選擇可用 Worker。
4. Specific target 不被其他 Worker 取代。
5. 等待 Worker 不占 scheduler slot。
6. Handoff 保留原 Worker。
7. Complete、cancel 與 failure 釋放 lease。
8. Process instance mismatch 不可恢復舊 session。

### 5.2 Responsive rendering

必須驗證：

1. 未指定 context 使用預設 viewport。
2. 不合理 viewport 回傳 HTTP 400。
3. Mobile viewport 取得 mobile responsive DOM。
4. Desktop viewport 取得 desktop responsive DOM。
5. Response 回傳 effective render context。
6. 並行 request 不交叉使用 viewport。

### 5.3 Handoff

必須驗證：

1. Anti-bot page 進入 `waiting_verification`。
2. Scheduler slot 被釋放。
3. Worker lease 被保留。
4. Continue 使用原 session。
5. Missing handoff 回傳 recovery action。

## 6. Security tests

必須驗證：

1. Public mode 套用公開 policy。
2. Token mode 拒絕無效 user token。
3. Role permission 控制 endpoint。
4. Provider registration 檢查 owner 與 permission。
5. Provider credential 不能呼叫 user REST API。
6. User token 不能取代 Provider WebSocket credential。
7. Rotation 使舊 provider credential 失效。
8. Revoke 關閉 Provider resources。
9. SSRF policy 拒絕未允許的 private target。

## 7. 文件驗證

```bash
npm run verify:utf8
git diff --check
```

API 變更必須同步：

1. Shared request／response types。
2. [API](../API.md)。
3. [OpenAPI](../openapi.yaml)。
4. Unit 或 integration contract test。
5. 必要時加入 E2E 情境。

## 8. 合併門檻

### 一般程式變更

1. `npm run typecheck` 通過。
2. 受影響 workspace tests 通過。
3. `npm run build` 通過。
4. UTF-8 與 diff check 通過。

### Browser、crawler 或 scheduler 變更

1. 一般門檻全部通過。
2. Backend full suite 通過。
3. Playwright E2E 通過。
4. Lease、handoff 與 concurrency case 不退化。

### 文件變更

1. 文件描述現行行為。
2. 不加入完成日誌或過期測試數字。
3. 不保留已移除設計的相容說明。
4. 文件索引與連結有效。
