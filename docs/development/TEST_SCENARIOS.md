# ComicCrawler 測試情境

## 1. 格式

1. 每個案例只驗證一個主要行為。
2. 每個步驟只描述一個動作。
3. 步驟維持簡短。
4. 複雜流程拆成連續案例。

## 2. API 與工作

### API-01 讀取服務狀態

1. 呼叫 status API。
2. 檢查版本資訊。
3. 檢查 adapter 統計。

預期：Server 回傳健康狀態。

### API-02 拒絕未知路由

1. 呼叫不存在的 API。
2. 檢查 HTTP status。

預期：Server 回傳 404。

### TASK-01 建立下載工作

1. 準備有效 URL。
2. 建立爬蟲工作。
3. 檢查 task ID。

預期：工作成功排入 queue。

### TASK-02 讀取工作清單

1. 建立一個工作。
2. 讀取工作清單。
3. 尋找該 task ID。

預期：清單包含新工作。

### TASK-03 拒絕無效工作

1. 送出空 URL。
2. 檢查 HTTP status。

預期：Server 回傳 client error。

## 3. Adapter

### ADP-01 讀取 adapter 清單

1. 呼叫 adapter list API。
2. 檢查回傳型別。

預期：回傳 adapter array。

### ADP-02 查看 adapter 詳情

1. 選擇已註冊 adapter。
2. 讀取 adapter 詳情。
3. 檢查 parse mode。

預期：parse mode 為 `playwright`。

### ADP-03 預覽 adapter

1. 開啟 Adapter Lab。
2. 選擇 adapter。
3. 檢查 implementation panel。

預期：頁面顯示完整 implementation。

### ADP-04 測試 adapter 函式

1. 選擇 adapter function。
2. 輸入符合用途的 URL。
3. 執行 function test。
4. 檢查 structured result。

預期：測試結果包含 readiness 與 timing。

### ADP-05 擷取 responsive chapter

1. 註冊 responsive fixture adapter。
2. 送出 mobile viewport request。
3. 送出 desktop viewport request。
4. 等待兩個 request。
5. 比對圖片 URL。
6. 比對 effective context。

預期：兩個 request 回傳各自版面與圖片順序。

## 4. Adapter discovery

### DISC-01 缺少 AO 設定

1. 清除 AO 設定。
2. 建立未知站點工作。
3. 讀取 discovery job。

預期：job 顯示 configuration required。

### DISC-02 使用 HTML snapshot

1. 準備 chapter snapshot。
2. 建立 snapshot discovery。
3. 讀取 job 狀態。

預期：job 使用 snapshot input。

### DISC-03 使用遠端頁面

1. 啟動 Browser Worker。
2. 建立 remote discovery。
3. 等待 DOM acquisition。

預期：job 使用 remote rendered page。

### DISC-04 產生 adapter

1. 建立 chapter discovery。
2. 等待 AO stages。
3. 讀取 implementation draft。

預期：draft 包含 chapter-images capability。

### DISC-05 發布 adapter

1. 開啟已完成 draft。
2. 接受 developer review。
3. 擷取 fixture。
4. 執行 fixture replay。
5. 發布 adapter。

預期：adapter 出現在 registry。

### DISC-06 驗證後開始 discovery

1. 開啟 challenge handoff。
2. 完成人工驗證。
3. 建立 discovery。

預期：discovery 使用已驗證 DOM。

### DISC-07 發布 challenge adapter

1. 完成 challenge discovery。
2. 接受 developer review。
3. 擷取 verified fixture。
4. 發布 adapter。

預期：adapter 可被 URL resolver 選中。

### CRAWL-01 使用新 adapter

1. 發布 generated adapter。
2. 建立 chapter task。
3. 等待工作完成。

預期：工作下載 fixture 圖片。

### CRAWL-02 使用 fixture adapter

1. 註冊 fixture adapter。
2. 建立 chapter task。
3. 等待工作完成。

預期：下載數量符合 expected result。

### CRAWL-03 使用 challenge adapter

1. 發布 challenge adapter。
2. 建立相同站點工作。
3. 完成人工驗證。
4. 恢復工作。

預期：工作從 checkpoint 完成。

## 5. Browser Provider

### BP-01 註冊 Provider

1. 讀取 Provider discovery。
2. 使用 user credential 註冊。
3. 保存 state file。
4. 保存 credential file。

預期：Server 建立 Provider identity。

### BP-02 連接 Worker

1. 讀取 Provider state。
2. 讀取 Provider credential。
3. 建立 control WebSocket。
4. 宣告 Worker capabilities。

預期：Worker 顯示 online 與 idle。

### BP-03 建立遠端 session

1. 選擇 idle Worker。
2. 取得 task lease。
3. 等待 session ready。
4. 連接 reverse relay。

預期：Server 可以連接 Playwright。

### BP-04 建立未知站點 handoff

1. 開啟 challenge fixture。
2. 建立未知站點工作。
3. 等待 challenge job。

預期：job 要求人工驗證。

### BP-05 建立 adapter handoff

1. 註冊 matched adapter。
2. 建立 challenge 工作。
3. 等待 handoff。
4. 檢查 Worker lease。

預期：工作保留原 Worker。

## 6. WebUI

### WEB-01 顯示 discovery 設定錯誤

1. 開啟建立工作頁。
2. 輸入未知站點。
3. 建立工作。
4. 檢查提示。

預期：頁面顯示設定入口。

### WEB-02 顯示 handoff 狀態

1. 建立 challenge job。
2. 開啟工作詳情。
3. 檢查 handoff 狀態。

預期：頁面顯示人工驗證動作。

### WEB-03 顯示 remote handoff

1. 建立 matched adapter handoff。
2. 開啟工作詳情。
3. 點擊 open browser。

預期：頁面顯示 remote browser 狀態。

### WEB-04 顯示遺失的 handoff

1. 建立 handoff。
2. 刪除 handoff resource。
3. 開啟工作詳情。

預期：頁面顯示重建動作。

## 7. 可靠性

### REL-01 釋放等待中的 scheduler slot

1. 建立等待驗證工作。
2. 建立另一個可執行工作。
3. 等待第二個工作。

預期：第二個工作不被第一個阻塞。

### REL-02 從 checkpoint 恢復

1. 執行多章節工作。
2. 在 challenge 中斷。
3. 完成人工驗證。
4. 恢復工作。

預期：已完成項目不重複下載。

## 8. 設定

### CFG-01 讀取設定

1. 呼叫 config API。
2. 檢查 server 設定。
3. 檢查 browser 設定。

預期：回傳目前 runtime config。

### CFG-02 儲存 browser 設定

1. 開啟設定頁。
2. 修改 browser timeout。
3. 儲存設定。
4. 重新讀取設定。

預期：新值已持久化。

### CFG-03 拒絕手動 WS endpoint

1. 送出手動 Playwright endpoint。
2. 檢查 API response。

預期：Server 拒絕繞過 Provider registry。

## 9. 安全

### SEC-01 套用 API policy

1. 啟用 token mode。
2. 送出無 token request。
3. 送出無權限 token。
4. 送出有效 token。

預期：只有被授權 request 通過。

### SEC-02 隔離 Provider credential

1. 註冊兩個 Provider。
2. 使用第一個 credential 連線。
3. 嘗試操作第二個 Provider。

預期：Server 拒絕跨 owner／Provider 操作。

### SEC-03 撤銷 Provider

1. 連接 Provider。
2. 撤銷其 credential。
3. 嘗試重新連線。

預期：Server 拒絕連線並清理資源。
