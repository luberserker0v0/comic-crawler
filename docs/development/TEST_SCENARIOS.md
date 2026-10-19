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

### ADP-06 拒絕不完整 reader DOM

1. 準備多頁 reader DOM。
2. 讓部分頁面缺少圖片 URL。
3. 執行 readiness 檢查。
4. 執行 chapter image extraction。

預期：系統拒絕不完整結果。

### ADP-07 隔離 draft runtime

1. 建立 adapter draft。
2. 執行 draft function test。
3. 讀取正式 adapter registry。

預期：draft 可執行但不會註冊為正式 adapter。

### ADP-08 保持 chapter page identity

1. 擷取同一個 chapter。
2. 更新 CDN host 與簽章。
3. 重排並插入 page。
4. 再次擷取 chapter。
5. 比對 chapter 與 page ID。

預期：既有 ID 不變，只有 `orderIndex` 與 URL 更新。

### ADP-09 偵測 source replacement

1. 擷取具有 fingerprint 的 page。
2. 保持相同 source key。
3. 更新 source fingerprint。
4. 再次建立 descriptor。

預期：page ID 不變，fingerprint 更新。

### ADP-10 保留 verification target

1. 使用 existing tab 擷取 chapter。
2. 回傳 challenge 頁面。
3. 讀取 handoff job。

預期：job 保留 owner、URL 與 target。

### ADP-11 重試 verified chapter

1. 完成既有 handoff 驗證。
2. 使用相同 challenge ID 重試。
3. 檢查 handoff 數量。

預期：回傳圖片且不建立重複 handoff。

### ADP-12 結束無法取得 target 的 handoff

1. 建立 deferred handoff。
2. 讓 target acquire 逾時。
3. 讀取 handoff 狀態。

預期：handoff 進入 failed。

### ADP-13 取消等待中的 handoff

1. 建立 deferred handoff。
2. 在 target acquire 前取消。
3. 完成延遲 acquire。

預期：handoff 保持 cancelled 並釋放 lease。

### COMIX-01 擷取 Comix fixture

1. 載入 Comix chapter fixture。
2. 執行 chapter image extraction。
3. 比對頁碼與 URL 順序。

預期：回傳全部圖片 URL。

### COMIX-02 驗證真實 Comix chapter

1. 連接 acceptance Consumer。
2. 建立 Comix chapter request。
3. 等待 challenge 通過。
4. 使用相同 challenge ID 重試。
5. 比對 reader page 與 URL 數量。

預期：同一 session 回傳完整有序 URL。

### COMIX-03 忽略被動 Cloudflare script

1. 準備完整 reader DOM。
2. 加入 challenge-platform script。
3. 執行 verification detection。

預期：頁面不需要 handoff。

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

### DISC-08 執行 AO implementation draft

1. 準備完成的 discovery job。
2. 讀取 implementation draft。
3. 執行 draft function test。
4. 檢查正式 adapter registry。

預期：draft 可測試但不會提前發布。

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

## 5. Browser Client

### BC-01 註冊 Client

1. 讀取 Client discovery。
2. 使用 user credential 註冊。
3. 保存 Client state。

預期：Server 建立 Client identity。

### BC-02 連接 Worker

1. 讀取 Client state。
2. 建立 command WebSocket。
3. 傳送 credential。
4. 宣告 capabilities。

預期：Worker 顯示 online 與 idle。

### BC-03 建立 command session

1. 選擇 idle Worker。
2. 取得 task lease。
3. 等待 session ready。
4. 執行 DOM command。

預期：Server 收到 rendered DOM。

### BC-04 建立未知站點 handoff

1. 開啟 challenge fixture。
2. 建立未知站點工作。
3. 等待 challenge job。

預期：job 要求人工驗證。

### BC-05 建立 adapter handoff

1. 註冊 matched adapter。
2. 建立 challenge 工作。
3. 等待 handoff。
4. 檢查 Worker lease。

預期：工作保留原 Worker。

### BC-06 註冊既有 tab

1. 連接 existing-tab Worker。
2. 註冊目前 tab。
3. 讀取 resource ID。

預期：Server 保存 opaque resource。

### BC-07 拒絕錯誤 tab URL

1. 註冊目前 tab。
2. 改變 tab URL。
3. 建立原 URL session。

預期：Session 拒絕採用該 tab。

### BC-08 拒絕撤銷使用中的 tab

1. 建立 existing-tab session。
2. 撤銷相同 resource。
3. 檢查 Worker 連線。

預期：Request 被拒絕且 Worker 保持 online。

### BC-09 重新註冊 tab resource

1. 註冊 tab resource。
2. 中斷 command WebSocket。
3. 重新連接 Client。
4. 讀取 Server resource。

預期：相同 resource ID 再次可用。

### BC-10 清理 managed Profile

1. 建立 temporary Profile。
2. 開啟 managed session。
3. 關閉 session。

預期：Browser context 與 Profile 均被清除。

### BC-11 處理 Profile 複製失敗

1. 建立 copy provisioner。
2. 模擬 Profile lock。
3. 檢查 temporary directory。

預期：複製失敗且暫存目錄被清除。

### BC-12 驗證 Consumer Executor

1. 建立 Consumer Executor。
2. 準備 contract case。
3. 執行共用 harness。
4. 檢查完成項目。

預期：Executor 通過共用操作契約。

### BC-13 連接正式環境

1. 準備 acceptance config。
2. 向正式 Server enroll。
3. 啟動 acceptance Consumer。
4. 檢查 Worker 狀態。
5. 建立 managed-profile 工作。
6. 等待真實 Chrome 開啟。

預期：正式 Server 可透過 SDK 操作 Chrome。

### BC-14 重用已驗證 session

1. 建立 adapter handoff。
2. 等待 challenge ready。
3. 使用 challenge ID 重試。
4. 檢查 Worker lease。

預期：重試沿用原 session，不租用第二個 session。

### BC-15 準備虛擬化 reader

1. 開啟虛擬化 reader。
2. 執行 `page.prepare-content`。
3. 讀取 prepared DOM。
4. 檢查每個 reader page。

預期：每頁保留 `data-comiccrawler-*` 圖片 URL。

### BC-16 中止 WebExtension command

1. 建立已中止的 command signal。
2. 呼叫 WebExtension driver。
3. 檢查 tab API 呼叫。

預期：Driver 回報取消且不操作 tab。

### BC-17 重啟後重新綁定 approved tab

1. 使用 existing-tab 建立工作。
2. 讓工作等待原 Worker。
3. 重啟 Browser Client process。
4. 再次批准同一分頁。
5. 註冊新 resource。
6. 呼叫 recovery API。

預期：原 task 使用新 target 繼續。

### BC-18 拒絕不安全的 target recovery

1. 建立可恢復工作。
2. 送出錯誤 owner。
3. 送出錯誤 URL。
4. 送出過期 target。
5. 送出無效狀態。

預期：Server 拒絕每個 replacement。

### BC-19 恢復人工驗證 handoff

1. 讓工作等待人工驗證。
2. 中斷原 Browser Client。
3. 重新批准同一分頁。
4. 呼叫 recovery API。
5. 讀取 handoff。

預期：handoff history 保留並綁定新 target。

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

### WEB-03 顯示 Browser Client handoff

1. 建立 matched adapter handoff。
2. 開啟工作詳情。
3. 點擊 open browser。

預期：頁面顯示 Browser Worker 狀態。

### WEB-04 顯示遺失的 handoff

1. 建立 handoff。
2. 刪除 challenge job。
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

### CFG-03 拒絕未知 browser 設定

1. 送出未定義的 transport 設定。
2. 檢查 API response。

預期：Server 回傳 400。

## 9. 安全

### SEC-01 套用 API policy

1. 啟用 token mode。
2. 送出無 token request。
3. 送出無權限 token。
4. 送出有效 token。

預期：只有被授權 request 通過。

### SEC-02 隔離 Browser Client credential

1. 註冊兩個 Browser Client。
2. 使用第一個 credential 連線。
3. 嘗試操作第二個 Client。

預期：Server 拒絕跨 owner／Client 操作。

### SEC-03 撤銷 Browser Client

1. 連接 Browser Client。
2. 撤銷其 credential。
3. 嘗試重新連線。

預期：Server 拒絕連線並清理資源。
