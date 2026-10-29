# Browser Client SDK

`@comiccrawler/browser-client-sdk` 是 ComicCrawler 使用者端 browser command SDK，production server 已使用此 protocol。

## 邊界

- 單一 package root。
- 不依賴 Playwright。
- 不依賴 Node API。
- 不依賴任何特定瀏覽器平台 API。
- Consumer 注入 `BrowserExecutor`。
- Consumer 注入 `ClientStateStore`。
- 缺少原生 WebSocket 時注入 `WebSocketFactory`。

## 使用方式

在 ComicCrawler repository 建置並產生可安裝套件：

```bash
cd repo
npm install
npm pack -w browser-client-sdk
```

接著在 Consumer project 安裝產生的 `.tgz`；正式發佈後可直接使用 package name：

```bash
npm install /path/to/comiccrawler-browser-client-sdk-0.1.0.tgz
# npm install @comiccrawler/browser-client-sdk
```

```ts
import { BrowserClient } from '@comiccrawler/browser-client-sdk';

const client = new BrowserClient({
  serverUrl: 'https://crawler.example.com',
  executor,
  stateStore,
});

await client.enroll({
  credentials: {
    userId: 'alice',
    userToken: 'user-api-token',
  },
});

const connection = await client.connect();
console.log(connection.workerId);
```

`enroll()` 只在第一次註冊或 credential 被撤銷後執行。它會把 Server
簽發的 Browser Client credential 寫入注入的 `ClientStateStore`。
後續啟動直接呼叫 `connect()`；SDK 會以 outbound WebSocket 連接 Server，
不會在使用者裝置開放 inbound port。

SDK 使用單一 `DriverBrowserExecutor`，並提供兩種頁面取得策略：

- `ExistingTabAcquisitionStrategy`：採用 Consumer 核准的現有分頁。
- `ManagedProfileAcquisitionStrategy`：透過 Consumer 的 profile launcher 建立分頁。

兩種策略取得頁面後，都進入相同的 `DriverBrowserSession` 指令流程。

Existing-tab Browser Client 不必暴露 Chrome `tabId`：

```ts
const resource = await client.registerResource({
  kind: 'tab',
  url: currentTab.url,
  title: currentTab.title,
  localHandle: currentTab.id,
});

// 建立 task 時傳入 connection.workerId 與 resource.resourceId。
```

Existing-tab Browser Client 的組裝方式：

```ts
const acquisition = new ExistingTabAcquisitionStrategy(browserPageDriver);
const executor = new DriverBrowserExecutor(browserPageDriver, acquisition);
```

Playwright consumer 的組裝方式：

```ts
const launcher = new PlaywrightManagedProfileLauncher(
  chromium,
  new FreshProfileProvisioner(profileDirectoryAccess),
);

const driver = new PlaywrightPageDriver();
const acquisition = new ManagedProfileAcquisitionStrategy(launcher);
const executor = new DriverBrowserExecutor(driver, acquisition);
```

`CopyProfileProvisioner` 也可使用，但 directory adapter 必須檢查來源
Profile lock，並執行實際複製。SDK 會固定排除 cache 與 lock 檔案；複製失敗
不會自動 fallback 成 fresh Profile。

SDK 不直接依賴 Playwright、Node API 或特定瀏覽器平台 API。Browser Client 只需把
對應 runtime 操作包成 driver 或 launcher。

Reader preparation 使用同一個 session 內的三段 operation：

1. `page.prepare.start` 建立游標並保存捲動位置。
2. `page.prepare.step` 在指定 action 與時間預算內推進。
3. `page.prepare.finish` 收集最後結果並還原捲動位置。

`start` 可接收 `reader.containerSelector`、`reader.pageSelector` 與選用的
`reader.endSelector`。SDK 只在 reader 範圍捲動與收集圖片；找到 page
元素後不再掃描整份文件。找不到 page 時才使用有界 fallback。

每次 `step` 回傳 `progressing` 或 `completed`，並帶回目前 phase、候選數、
已處理數、圖片數與 fallback 步數。Server 依進度決定是否繼續，不把整個
reader 綁在一個 Browser command timeout。Session 關閉時 SDK 也會對尚未
結束的 operation 執行一次 cleanup。

虛擬化 reader 已載入的 URL 會保存在 `data-comiccrawler-src` /
`data-comiccrawler-image-url`。

## Executor contract test

Consumer 可以在自己的測試 runner 呼叫相同的 portable harness：

```ts
import { runBrowserExecutorContract } from '@comiccrawler/browser-client-sdk';

await runBrowserExecutorContract({
  createExecutor: () => executor,
  request,
  resource,
  expectedInitialUrl,
  expectedInitialHtml,
  navigationUrl,
});
```

Harness 會驗證 capability、resource、session、DOM、content preparation、navigation、focus 與
cleanup contract，且不依賴 Jest、Vitest 或 Node test API。

完整架構與 protocol 見
[Browser Client Framework](https://github.com/luberserker0v0/comic-crawler/blob/main/docs/development/BROWSER_CLIENT_FRAMEWORK.md)。
