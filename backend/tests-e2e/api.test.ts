import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import {
  BrowserClient,
  DriverBrowserExecutor,
  ExistingTabAcquisitionStrategy,
  type BrowserPageDriver,
  type BrowserClientSocket,
  type BrowserClientState,
  type ClientStateStore,
  type ReaderPreparationSelectors,
} from '@comiccrawler/browser-client-sdk';

const adapterChapterUrl = 'http://127.0.0.1:4173/api/fixtures/discovery-chapter';

let adapterDiscoveryId = '';

const matchedChallengeUrl = 'http://127-0-0-1.nip.io:4173/api/fixtures/challenge-never-clears?matched-adapter=1';

let matchedTaskId = '';

let matchedChallengeDiscoveryId = '';

const challengeChapterUrl = 'http://localhost:4173/api/fixtures/challenge-clears';

let challengeAdapterDiscoveryId = '';

const selectorDiscoveryConfig = {
  aoBaseUrl: 'http://127.0.0.1:4173/__ao',
  model: 'my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive',
  providerDocument: {
    provider: {
      my_local_lmstudio: {
        name: 'my local lmstudio',
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: 'http://host.docker.internal:25555/v1', apiKey: 'nopassword' },
        models: {
          'gemma-4-e4b-uncensored-hauhaucs-aggressive': {
            name: 'gemma-4-e4b-uncensored-hauhaucs-aggressive',
          },
        },
      },
    },
  },
};

test.describe('ComicCrawler E2E', () => {
  ComicCrawlerE2ETestGroup1();
  ComicCrawlerE2ETestGroup2();
  ComicCrawlerE2ETestGroup3();
});

async function waitForTask(request: any, taskId: string, expectedStatus: string): Promise<any> {
  const startedAt = Date.now();
  let latest: any;
  while (Date.now() - startedAt < 60000) {
    const response = await request.get(`/api/tasks/${taskId}`);
    expect(response.status()).toBe(200);
    latest = (await response.json()).data;
    if (latest.task.status === expectedStatus) {
      return latest;
    }
    if (latest.task.status === 'failed') {
      throw new Error(`Task failed: ${latest.task.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for task ${taskId} to reach ${expectedStatus}. Latest: ${JSON.stringify(latest)}`);
}
async function createReliabilityTask(request: any, chapterUrl: string, priority = 0): Promise<string> {
  const response = await request.post('/api/tasks', {
    data: {
      url: chapterUrl,
      adapterId: 'reliability-fixture',
      mode: 'chapters',
      chapterUrls: [chapterUrl],
      priority,
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.data.kind).toBe('taskCreated');
  return body.data.taskId;
}

async function waitForDiscovery(request: any, discoveryId: string, expectedStatus: string): Promise<any> {
  const startedAt = Date.now();
  let latest: any;
  while (Date.now() - startedAt < 60000) {
    const response = await request.get(`/api/selector-discovery/${discoveryId}`);
    expect(response.status()).toBe(200);
    latest = (await response.json()).data;
    if (latest.status === expectedStatus) {
      return latest;
    }
    if (latest.status === 'failed' || latest.status === 'invalid') {
      throw new Error(`Discovery failed: ${JSON.stringify(latest)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for discovery ${discoveryId} to reach ${expectedStatus}. Latest: ${JSON.stringify(latest)}`);
}

async function waitForChallengeDiscovery(request: any, discoveryId: string, expectedStatus: string): Promise<any> {
  const startedAt = Date.now();
  let latest: any;
  while (Date.now() - startedAt < 60000) {
    const response = await request.get(`/api/challenge-discovery/${discoveryId}`);
    expect(response.status()).toBe(200);
    latest = (await response.json()).data;
    if (latest.status === expectedStatus) {
      return latest;
    }
    if (latest.status === 'failed') {
      throw new Error(`Challenge discovery failed: ${JSON.stringify(latest)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for challenge discovery ${discoveryId} to reach ${expectedStatus}. Latest: ${JSON.stringify(latest)}`);
}

async function configureSelectorDiscovery(request: any): Promise<void> {
  const response = await request.put('/api/config/selector-discovery', {
    data: selectorDiscoveryConfig,
  });
  expect(response.status()).toBe(200);
}

function createExistingTabClient(
  stateStore: E2eClientStateStore,
  driver: E2eExistingTabDriver,
  processPrefix: string
): BrowserClient {
  let sequence = 0;
  return new BrowserClient({
    serverUrl: 'http://127.0.0.1:4173',
    executor: new DriverBrowserExecutor(driver, new ExistingTabAcquisitionStrategy(driver)),
    stateStore,
    webSocketFactory: {
      create: (url) => new WebSocket(url) as unknown as BrowserClientSocket,
    },
    randomUUID: () => `${processPrefix}-${++sequence}`,
  });
}

class E2eClientStateStore implements ClientStateStore {
  constructor(private state?: BrowserClientState) {}
  async get(): Promise<BrowserClientState | undefined> { return this.state; }
  async set(state: BrowserClientState): Promise<void> { this.state = structuredClone(state); }
  async clear(): Promise<void> { this.state = undefined; }
}

class E2eExistingTabDriver implements BrowserPageDriver<number> {
  private releaseBlockedCommands?: () => void;
  private readonly blockedCommands: Promise<void>;

  constructor(private url: string, blockCommands: boolean) {
    this.blockedCommands = blockCommands
      ? new Promise<void>((resolve) => { this.releaseBlockedCommands = resolve; })
      : Promise.resolve();
  }

  releaseCommands(): void {
    this.releaseBlockedCommands?.();
    this.releaseBlockedCommands = undefined;
  }

  async currentUrl(_tabId: number, signal: AbortSignal): Promise<string> {
    assertE2eCommandActive(signal);
    return this.url;
  }

  async navigate(_tabId: number, url: string, signal: AbortSignal): Promise<string> {
    assertE2eCommandActive(signal);
    this.url = url;
    return url;
  }

  async content(_tabId: number, signal: AbortSignal): Promise<string> {
    await this.wait(signal);
    return '<!doctype html><html><body><main id="reader"><img class="recovery-page" data-src="/api/fixtures/discovery-image.jpg" /></main></body></html>';
  }

  async waitForReady(_tabId: number, _timeoutMs: number | undefined, signal: AbortSignal): Promise<void> {
    await this.wait(signal);
  }

  async prepareContent(_tabId: number, _strategy: 'scroll-through',
    _reader: ReaderPreparationSelectors | undefined, signal: AbortSignal) {
    assertE2eCommandActive(signal);
    return { progress: preparationProgress('progressing'),
      step: async (_budget: unknown, stepSignal: AbortSignal) => {
        await this.wait(stepSignal); return preparationProgress('completed');
      }, finish: async () => undefined };
  }

  async focus(_tabId: number, signal: AbortSignal): Promise<void> { assertE2eCommandActive(signal); }

  private async wait(signal: AbortSignal): Promise<void> {
    assertE2eCommandActive(signal);
    await Promise.race([this.blockedCommands, e2eAbortPromise(signal)]);
    assertE2eCommandActive(signal);
  }
}

function preparationProgress(status: 'progressing' | 'completed') {
  return { status, phase: status === 'completed' ? 'completed' as const : 'candidates' as const,
    discoveredCandidates: 1, processedCandidates: status === 'completed' ? 1 : 0,
    capturedImages: status === 'completed' ? 1 : 0, fallbackSteps: 0 };
}

function e2eAbortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function assertE2eCommandActive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Browser Client command was cancelled.');
}

function challengeAdapterTestGroup1(): void {
  test('DISC-06 challenge 後開始 discovery', challengeAdapterTestDISC06ChallengeDiscovery);
  test('DISC-07 發佈 challenge adapter', challengeAdapterTestDISC07ChallengeAdapter);
  test('CRAWL-03 使用 challenge adapter', challengeAdapterTestCRAWL03ChallengeAdapter);
}

async function challengeAdapterTestDISC06ChallengeDiscovery({ request }) {
    await test.step('1. 設定 selector discovery', async () => {
        await configureSelectorDiscovery(request);
    });
    const discoveryResponse = await test.step('2. 送出 challenge 網址', async () => request.post('/api/tasks', {
        data: {
            url: challengeChapterUrl,
            mode: 'chapters',
            chapterUrls: [challengeChapterUrl],
        },
    }));
    await test.step('3. 檢查 discovery 結果', async () => {
        expect(discoveryResponse.status()).toBe(202);
        const discoveryBody = await discoveryResponse.json();
        expect(discoveryBody.data.kind).toBe('discoveryQueued');
        challengeAdapterDiscoveryId = discoveryBody.data.discoveryId;
        const job = await waitForDiscovery(request, challengeAdapterDiscoveryId, 'awaiting_review');
        expect(job.adapterImplementationTs).toContain("$('img.page-image')");
    });
}

async function challengeAdapterTestDISC07ChallengeAdapter({ request }) {
    const response = await test.step('1. 發佈 adapter', async () => (request.post(`/api/selector-discovery/${challengeAdapterDiscoveryId}/promote`)));
    await test.step('2. 檢查發佈結果', async () => {
        expect(response.status()).toBe(200);
    });
}

async function challengeAdapterTestCRAWL03ChallengeAdapter({ request }) {
    const taskResponse = await test.step('1. 建立章節工作', async () => request.post('/api/tasks', {
        data: {
            url: challengeChapterUrl,
            mode: 'chapters',
            chapterUrls: [challengeChapterUrl],
        },
    }));
    await test.step('2. 檢查建立結果', async () => {
        expect(taskResponse.status()).toBe(201);
    });
    await test.step('3. 檢查下載結果', async () => {
        const taskBody = await taskResponse.json();
        const completed = await waitForTask(request, taskBody.data.taskId, 'completed');
        expect(completed.result.totalImages).toBe(1);
        expect(completed.result.downloadedImages).toBe(1);
    });
}

function matchedAdapterHandoffTestGroup1(): void {
  test('BC-05 建立 adapter handoff', matchedAdapterHandoffTestBC05AdapterHandoff);
  test('WEB-03 顯示 remote handoff', matchedAdapterHandoffTestWEB03RemoteHandoff);
  test('WEB-04 顯示遺失的 handoff', matchedAdapterHandoffTestWEB04Handoff);
}

async function matchedAdapterHandoffTestBC05AdapterHandoff({ request }) {
    test.setTimeout(90000);
    const register = await registerMatchedChallengeAdapter(request);
    expect(register.status()).toBe(200);
    const response = await createMatchedChallengeTask(request);
    await captureMatchedTask(response);
    await expectMatchedHandoff(request);
}

function matchedChallengeManifest() {
    return {
        adapterId: 'matched-challenge-e2e', name: 'Matched Challenge E2E',
        domains: ['127-0-0-1.nip.io'], urlPatterns: [matchedChallengeUrl],
        capabilities: { verification: true, metadata: false, chapterImages: true },
        selectors: { images: { container: '#reader', item: 'img.page-image', srcAttr: 'data-src' } },
        sourceDiscoveryId: 'matched-challenge-e2e', promotedAt: new Date().toISOString(),
    };
}

async function registerMatchedChallengeAdapter(request: any) {
    return test.step('1. 註冊測試 adapter', async () => request.post(
        '/__test/register-fixture-replay-generated-adapter', { data: matchedChallengeManifest() },
    ));
}

async function createMatchedChallengeTask(request: any) {
    return test.step('2. 建立章節工作', async () => request.post('/api/tasks', {
        data: { url: matchedChallengeUrl, mode: 'chapters', chapterUrls: [matchedChallengeUrl] },
    }));
}

async function captureMatchedTask(response: any): Promise<void> {
    await test.step('3. 檢查建立結果', async () => {
        expect(response.status()).toBe(201);
        const body = await response.json();
        expect(body.data.kind).toBe('taskCreated');
        matchedTaskId = body.data.taskId;
    });
}

async function expectMatchedHandoff(request: any): Promise<void> {
    await test.step('4. 等待 handoff', async () => {
        const waiting = await waitForTask(request, matchedTaskId, 'waiting_verification');
        matchedChallengeDiscoveryId = waiting.result.challengeDiscoveryId;
        expect(matchedChallengeDiscoveryId).toBeDefined();
        expect(waiting.result.error).toContain('Human verification is required');
    });
}

async function matchedAdapterHandoffTestWEB03RemoteHandoff({ page }) {
    await test.step('1. 開啟工作詳情', async () => {
        await page.goto(`/tasks/${matchedTaskId}`);
    });
    const handoff = page.getByTestId('task-verification-handoff');
    await test.step('2. 檢查 handoff 資訊', async () => {
        await expect(handoff).toBeVisible();
        await expect(handoff).toContainText('Human verification required');
        await expect(handoff).toContainText(matchedChallengeDiscoveryId);
        await expect(handoff).toContainText(/Open browser for verification|Reopen browser for verification/);
    });
    await test.step('3. 檢查舊欄位已移除', async () => {
        await expectLegacyHandoffControlsAbsent(page, handoff);
    });
}

async function expectLegacyHandoffControlsAbsent(page: any, handoff: any): Promise<void> {
    await expect(page.getByTestId('verification-browser-path-input')).toHaveCount(0);
    await expect(page.getByTestId('verification-browser-profile-select')).toHaveCount(0);
    for (const text of ['Promote strategy', 'Open headed browser', 'Open in my browser',
        'Browser executable path', 'Create adapter from attached browser page']) {
        await expect(handoff).not.toContainText(text);
    }
}

async function matchedAdapterHandoffTestWEB04Handoff({ page, request }) {
    await simulateMissingHandoff(page);
    await test.step('2. 開啟工作詳情', async () => {
        await page.goto(`/tasks/${matchedTaskId}`);
    });
    await test.step('3. 檢查恢復提示', async () => {
        await expect(page.getByTestId('challenge-job-unavailable-message')).toContainText('Continue to recreate it');
        await expect(page.getByTestId('open-verification-browser-button')).toHaveCount(0);
    });
    await test.step('4. 清理 handoff', async () => {
        expect((await request.delete(`/api/challenge-discovery/${matchedChallengeDiscoveryId}`)).status()).toBe(200);
    });
}

async function simulateMissingHandoff(page: any): Promise<void> {
    await test.step('1. 模擬 handoff 遺失', async () => {
        await page.route(`**/api/challenge-discovery/${matchedChallengeDiscoveryId}`, async (route) => {
            await route.fulfill({ status: 404, contentType: 'application/json',
                body: JSON.stringify({ error: 'Challenge discovery job not found.' }) });
        });
    });
}

function ChapterAdapterTestGroup1(): void {
  test('DISC-04 產生 adapter', ChapterAdapterTestDISC04Adapter);
  test('DISC-05 發佈 adapter', ChapterAdapterTestDISC05Adapter);
  test('CRAWL-01 使用新 adapter', ChapterAdapterTestCRAWL01Adapter);
}

async function ChapterAdapterTestDISC04Adapter({ request }) {
    await test.step('1. 設定 selector discovery', async () => {
        await configureSelectorDiscovery(request);
    });
    const discoveryResponse = await enqueueAdapterDiscovery(request);
    await captureAdapterDiscovery(discoveryResponse);
    await test.step('4. 檢查 adapter 草稿', async () => {
        const job = await waitForDiscovery(request, adapterDiscoveryId, 'awaiting_review');
        expect(job.adapterImplementationTs).toContain('class E2EChapterImagesCapability');
        expect(job.implementationValidation.valid).toBe(true);
    });
}

async function enqueueAdapterDiscovery(request: any) {
    return test.step('2. 送出未知網址', async () => request.post('/api/tasks', {
        data: { url: adapterChapterUrl, mode: 'chapters', chapterUrls: [adapterChapterUrl] },
    }));
}

async function captureAdapterDiscovery(response: any): Promise<void> {
    await test.step('3. 檢查排程結果', async () => {
        expect(response.status()).toBe(202);
        const body = await response.json();
        expect(body.data.kind).toBe('discoveryQueued');
        expect(body.data.reason).toBe('adapter_not_found');
        adapterDiscoveryId = body.data.discoveryId;
    });
}

async function ChapterAdapterTestDISC05Adapter({ request }) {
    const promoteResponse = await test.step('1. 發佈 adapter', async () => (request.post(`/api/selector-discovery/${adapterDiscoveryId}/promote`)));
    await test.step('2. 檢查發佈結果', async () => {
        expect(promoteResponse.status()).toBe(200);
        const promoted = await promoteResponse.json();
        expect(promoted.data.adapterId).toBe('127-0-0-1');
        expect(promoted.data.capabilities).toMatchObject({ verification: true, metadata: false, chapterImages: true });
    });
    await test.step('3. 檢查 adapter 詳情', async () => {
        const adapterResponse = await request.get('/api/adapters/127-0-0-1');
        expect(adapterResponse.status()).toBe(200);
        const adapterBody = await adapterResponse.json();
        expect(adapterBody.data.parseMode).toBe('playwright');
        expect(adapterBody.data.capabilities).toMatchObject({ verification: true, metadata: false, chapterImages: true });
    });
}

async function ChapterAdapterTestCRAWL01Adapter({ request }) {
    const response = await createAdapterChapterTask(request);
    let taskId = '';
    await test.step('2. 檢查建立結果', async () => {
        expect(response.status()).toBe(201);
        const body = await response.json();
        taskId = body.data.taskId;
        expect(taskId).toBeDefined();
    });
    await test.step('3. 檢查下載結果', async () => {
        const completed = await waitForTask(request, taskId, 'completed');
        expect(completed.result.totalImages).toBe(1);
        expect(completed.result.downloadedImages).toBe(1);
    });
}

async function createAdapterChapterTask(request: any) {
    return test.step('1. 建立章節工作', async () => request.post('/api/tasks', {
        data: { url: adapterChapterUrl, mode: 'chapters', chapterUrls: [adapterChapterUrl] },
    }));
}

function ComicCrawlerE2ETestGroup1(): void {
  test.beforeEach(ComicCrawlerE2ETestScenario1);
  test('API-01 服務狀態', ComicCrawlerE2ETestAPI01);
  test('TASK-01 建立下載工作', ComicCrawlerE2ETestTASK01);
  test('TASK-02 讀取工作清單', ComicCrawlerE2ETestTASK02);
  test('CFG-01 讀取設定', ComicCrawlerE2ETestCFG01);
  test('ADP-01 讀取 adapter 清單', ComicCrawlerE2ETestADP01Adapter);
  test('API-02 拒絕未知路由', ComicCrawlerE2ETestAPI02);
  test('TASK-03 拒絕無效工作', ComicCrawlerE2ETestTASK03);
  test('ADP-02 查看 adapter 詳情', ComicCrawlerE2ETestADP02Adapter);
  test('DISC-01 缺少 discovery 設定', ComicCrawlerE2ETestDISC01Discovery);
}

function ComicCrawlerE2ETestGroup2(): void {
  test('WEB-01 顯示 discovery 設定錯誤', ComicCrawlerE2ETestWEB01Discovery);
  test('ADP-03 預覽 adapter', ComicCrawlerE2ETestADP03Adapter);
  test('ADP-04 測試 adapter 函式', ComicCrawlerE2ETestADP04Adapter);
  test.describe.serial('新站點 chapter adapter', ComicCrawlerE2ETestChapterAdapter);
  test('DISC-02 使用 HTML snapshot', ComicCrawlerE2ETestDISC02HTMLSnapshot);
  test('DISC-03 使用遠端頁面', ComicCrawlerE2ETestDISC03);
  test('CRAWL-02 使用 fixture adapter', ComicCrawlerE2ETestCRAWL02FixtureAdapter);
  test('ADP-05 依 render context 擷取 responsive 圖片', ComicCrawlerE2ETestADP05RenderContextResponsive);
  test('BC-04 建立未知站點 handoff', ComicCrawlerE2ETestBC04Handoff);
  test('BC-17 Browser Client process 重啟後明確恢復原 task', ComicCrawlerE2ETestBC17BrowserClientProcessTask);
}

function ComicCrawlerE2ETestGroup3(): void {
  test.describe.serial('matched adapter handoff', ComicCrawlerE2ETestMatchedAdapterHandoff);
  test('REL-01 釋放等待中的 queue slot', ComicCrawlerE2ETestREL01QueueSlot);
  test('REL-02 從 checkpoint 恢復', ComicCrawlerE2ETestREL02Checkpoint);
  test('WEB-02 顯示 handoff 狀態', ComicCrawlerE2ETestWEB02Handoff);
  test.describe.serial('challenge 後建立 adapter', ComicCrawlerE2ETestChallengeAdapter);
  test('CFG-02 儲存 browser 設定', ComicCrawlerE2ETestCFG02Browser);
  test('CFG-03 拒絕未定義的 browser transport 設定', ComicCrawlerE2ETestCFG03BrowserTransport);
}

async function ComicCrawlerE2ETestScenario1({ request }) {
    const response = await request.put('/api/config', {
        data: { i18n: { language: 'en-US', fallback: 'en' } },
    });
    expect(response.ok()).toBeTruthy();
}

async function ComicCrawlerE2ETestAPI01({ request }) {
    const response = await request.get('/api/status');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.version).toBe('0.4.0');
    expect(body.data.adapters).toBeDefined();
    expect(body.data.adapters.loaded).toBeGreaterThanOrEqual(0);
}

async function ComicCrawlerE2ETestTASK01({ request }) {
    const response = await request.post('/api/tasks', {
        data: {
            url: 'https://kuronavi.one/manga/test',
            adapterId: 'kuronavi',
        },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.data.taskId).toBeDefined();
}

async function ComicCrawlerE2ETestTASK02({ request }) {
    const response = await request.get('/api/tasks');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.data.tasks).toBeDefined();
    expect(Array.isArray(body.data.tasks)).toBeTruthy();
}

async function ComicCrawlerE2ETestCFG01({ request }) {
    const response = await request.get('/api/config');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.download).toBeDefined();
    expect(body.data.server).toBeDefined();
}

async function ComicCrawlerE2ETestADP01Adapter({ request }) {
    const response = await request.get('/api/adapters');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBeTruthy();
}

async function ComicCrawlerE2ETestAPI02({ request }) {
    const response = await request.get('/api/nonexistent');
    expect(response.status()).toBe(404);
}

async function ComicCrawlerE2ETestTASK03({ request }) {
    const response = await request.post('/api/tasks', {
        data: {
            url: '',
        },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
}

async function ComicCrawlerE2ETestADP02Adapter({ request }) {
    const response = await request.get('/api/adapters/kuronavi');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe('kuronavi');
    expect(body.data.parseMode).toBe('playwright');
}

async function ComicCrawlerE2ETestDISC01Discovery({ request }) {
    const response = await request.post('/api/tasks', {
        data: {
            url: 'https://unknown-e2e.example/manga/demo/chapter-1',
            mode: 'chapters',
            chapterUrls: ['https://unknown-e2e.example/manga/demo/chapter-1'],
        },
    });
    expect(response.status()).toBe(202);
    const body = await response.json();
    expect(body.data.kind).toBe('discoveryQueued');
    expect(body.data.status).toBe('configuration_required');
    expect(body.data.target).toBe('chapter-only');
    expect(body.data.discoveryId).toBeDefined();
    const jobResponse = await request.get(`/api/selector-discovery/${body.data.discoveryId}`);
    expect(jobResponse.status()).toBe(200);
    const job = await jobResponse.json();
    expect(job.data.status).toBe('configuration_required');
    expect(job.data.error).toContain('Selector discovery is not configured');
}

async function ComicCrawlerE2ETestWEB01Discovery({ page }) {
    await page.goto('/');
    await page.getByTestId('task-mode-chapters').click();
    await page.getByTestId('chapter-url-input-0').fill('https://unknown-ui-e2e.example/manga/demo/chapter-1');
    await page.getByTestId('create-task-submit').click();
    const status = page.getByTestId('adapter-build-task-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Adapter build task created.');
    await expect(status).toContainText('configuration_required');
    await expect(status).toContainText('Open Settings');
}

async function ComicCrawlerE2ETestADP03Adapter({ page }) {
    await page.goto('/');
    await page.getByTestId('task-mode-chapters').click();
    await page.getByTestId('chapter-url-input-0').fill('https://kuronavi.one/manga/demo/chapter-1');
    const preview = page.getByTestId('adapter-resolution-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Kuronavi E2E Fixture');
    await expect(preview).toContainText('kuronavi');
    await expect(preview).toContainText('Images O');
}

async function ComicCrawlerE2ETestADP04Adapter({ page }) {
    await page.goto('/adapter-lab');
    await page.getByTestId('adapter-lab-url').fill('https://kuronavi.one/manga/test');
    await page.getByTestId('adapter-lab-resolve').click();
    await expect(page.getByText(/Status:/)).toBeVisible();
    await page.getByRole('button', { name: 'Manga metadataO', exact: true }).click();
    await page.getByRole('button', { name: /^extractTitle/ }).first().click();
    await expect(page.getByText(/project-source/i)).toBeVisible();
    await expect(page.getByText(/async extractTitle/i)).toBeVisible();
    await page.getByTestId('adapter-lab-test').click();
    await expect(page.locator('.font-semibold').filter({ hasText: /Test passed/ })).toBeVisible();
    await expect(page.getByText(/"title": "Fixture"/)).toBeVisible();
}

function ComicCrawlerE2ETestChapterAdapter() {
    ChapterAdapterTestGroup1();
}

const snapshotChapterHtml = `<!doctype html>
<html><head><title>Snapshot Chapter</title></head><body><main id="reader">
<img class="page-image" data-src="/api/fixtures/discovery-image.jpg" />
</main></body></html>`;

async function ComicCrawlerE2ETestDISC02HTMLSnapshot({ request }) {
    await configureSelectorDiscovery(request);
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/snapshot-chapter';
    const response = await request.post('/api/selector-discovery/snapshot', {
        data: { url: chapterUrl, target: 'chapter-only', html: snapshotChapterHtml },
    });
    expect(response.status()).toBe(202);
    const body = await response.json();
    expect(body.data.inputSource).toBe('html-snapshot');
    await expectSnapshotDiscovery(request, body.data.id);
}

async function expectSnapshotDiscovery(request: any, discoveryId: string): Promise<void> {
    const job = await waitForDiscovery(request, discoveryId, 'awaiting_review');
    expect(job.status).toBe('awaiting_review');
    expect(job.target).toBe('chapter-only');
    expect(job.phase1Markdown).toContain('Snapshot source: user-provided rendered chapter HTML');
    expect(job.adapterImplementationTs).toContain("$('img.page-image')");
}

async function ComicCrawlerE2ETestDISC03({ request }) {
    test.setTimeout(90000);
    await configureSelectorDiscovery(request);
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/discovery-chapter';
    const challenge = await request.post('/api/challenge-discovery', {
        data: { url: chapterUrl }, timeout: 10000,
    });
    expect(challenge.status()).toBe(202);
    const challengeBody = await challenge.json();
    await expectRemoteDiscovery(request, challengeBody.data.id);
}

async function expectRemoteDiscovery(request: any, challengeId: string): Promise<void> {
    const open = await request.post(`/api/challenge-discovery/${challengeId}/open-browser`);
    expect(open.status()).toBe(200);
    const response = await request.post(
        `/api/challenge-discovery/${challengeId}/create-selector-discovery-from-remote`,
        { timeout: 15000 },
    );
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(202);
    expect(body.data.challenge.status).toBe('ready');
    expect(body.data.discovery.inputSource).toBe('html-snapshot');
    expect(body.data.discovery.target).toBe('chapter-only');
    expect(body.data.discovery.status).toBe('queued');
}

async function ComicCrawlerE2ETestCRAWL02FixtureAdapter({ request }) {
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/fixture-replay-generated-chapter';
    const register = await registerFixtureReplayAdapter(request);
    expect(register.status()).toBe(200);
    const response = await request.post('/api/tasks', {
        data: {
            url: chapterUrl,
            mode: 'chapters',
            chapterUrls: [chapterUrl],
        },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    const completed = await waitForTask(request, body.data.taskId, 'completed');
    expect(completed.result.totalImages).toBe(1);
    expect(completed.result.downloadedImages).toBe(1);
}

function fixtureReplayManifest() {
    return {
        adapterId: 'fixture-replay-generated-e2e', name: 'Fixture Replay Generated E2E',
        domains: ['127.0.0.1'],
        urlPatterns: ['http://127.0.0.1:4173/api/fixtures/fixture-replay-generated-*'],
        capabilities: { verification: true, metadata: false, chapterImages: true },
        selectors: { images: { container: '#reader', item: 'img.fixture-replay-page', srcAttr: 'data-src' } },
        sourceDiscoveryId: 'fixture-replay-generated-e2e', promotedAt: new Date().toISOString(),
    };
}

async function registerFixtureReplayAdapter(request: any) {
    return request.post('/__test/register-fixture-replay-generated-adapter', {
        data: fixtureReplayManifest(),
    });
}

async function ComicCrawlerE2ETestADP05RenderContextResponsive({ request }) {
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/responsive-chapter';
    const register = await registerResponsiveAdapter(request, chapterUrl);
    expect(register.status()).toBe(200);
    const responses = await requestResponsiveImages(request, chapterUrl);
    await expectResponsiveImages(...responses);
}

function responsiveManifest(chapterUrl: string) {
    return {
        adapterId: 'responsive-chapter-e2e', name: 'Responsive Chapter E2E',
        domains: ['127.0.0.1'], urlPatterns: [chapterUrl],
        capabilities: { verification: true, metadata: false, chapterImages: true },
        selectors: { images: { container: '#reader', item: 'img.responsive-page', srcAttr: 'data-src' } },
        sourceDiscoveryId: 'responsive-chapter-e2e', promotedAt: new Date().toISOString(),
    };
}

async function registerResponsiveAdapter(request: any, chapterUrl: string) {
    return test.step('1. 註冊 responsive adapter', async () => request.post(
        '/__test/register-fixture-replay-generated-adapter', { data: responsiveManifest(chapterUrl) },
    ));
}

function responsiveRequest(chapterUrl: string, renderContext: any) {
    return { data: { url: chapterUrl, adapterId: 'responsive-chapter-e2e', renderContext } };
}

async function requestResponsiveImages(request: any, chapterUrl: string): Promise<any[]> {
    return test.step('2. 並行送出不同 viewport', async () => Promise.all([
        request.post('/api/adapters/chapter-images', responsiveRequest(chapterUrl,
            { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })),
        request.post('/api/adapters/chapter-images', responsiveRequest(chapterUrl,
            { viewport: { width: 1440, height: 900 } })),
    ]));
}

async function expectResponsiveImages(mobileResponse: any, desktopResponse: any): Promise<void> {
    await test.step('3. 驗證 mobile 與 desktop 結果', async () => {
        expect(mobileResponse.status()).toBe(200);
        expect(desktopResponse.status()).toBe(200);
        const mobile = (await mobileResponse.json()).data;
        const desktop = (await desktopResponse.json()).data;
        expect(mobile.renderContext).toEqual({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
        expect(desktop.renderContext).toEqual({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        expect(mobile.imageUrls).toEqual(responsiveImageUrls('mobile'));
        expect(desktop.imageUrls).toEqual(responsiveImageUrls('desktop'));
    });
}

function responsiveImageUrls(mode: 'mobile' | 'desktop'): string[] {
    return [1, 2].map((index) => `http://127.0.0.1:4173/api/fixtures/responsive-${mode}-${index}.jpg`);
}

async function ComicCrawlerE2ETestBC04Handoff({ request }) {
    await configureSelectorDiscovery(request);
    const challengeUrl = 'http://127.0.0.1:4173/api/fixtures/challenge-never-clears';
    const response = await request.post('/api/tasks', {
        data: {
            url: challengeUrl,
            mode: 'chapters',
            chapterUrls: [challengeUrl],
        },
    });
    expect(response.status()).toBe(202);
    const body = await response.json();
    expect(body.data.kind).toBe('challengeDiscoveryQueued');
    const job = await waitForChallengeDiscovery(request, body.data.challengeDiscoveryId, 'challenge_required');
    expect(job.candidateSource).toBeUndefined();
    expect(job.diagnosisMarkdown).toContain('human verification handoff');
    expect((await request.delete(`/api/challenge-discovery/${job.id}`)).status()).toBe(200);
}

async function ComicCrawlerE2ETestBC17BrowserClientProcessTask({ request }) {
    test.setTimeout(60000);
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/browser-target-recovery-chapter';
    const register = await registerRecoveryAdapter(request, chapterUrl);
    expect(register.status()).toBe(200);
    const context = await createRecoveryContext(chapterUrl);
    try {
        await occupyRecoveryWorker(request, context);
        context.taskId = await queueRecoveryTask(request, context);
        await restartRecoveryClient(context);
        await rebindRecoveryTarget(request, context);
        await expectRecoveredTask(request, context);
    } finally {
        await closeRecoveryContext(context);
    }
}

interface RecoveryContext {
    chapterUrl: string;
    firstStore: E2eClientStateStore;
    firstDriver: E2eExistingTabDriver;
    firstClient: BrowserClient;
    firstConnection: any;
    firstResource: any;
    secondClient?: BrowserClient;
    secondConnection?: any;
    secondResource?: any;
    busyRequest?: Promise<any>;
    taskId?: string;
}

function recoveryManifest(chapterUrl: string) {
    return {
        adapterId: 'browser-target-recovery-e2e', name: 'Browser Target Recovery E2E',
        domains: ['127.0.0.1'], urlPatterns: [chapterUrl],
        capabilities: { verification: true, metadata: false, chapterImages: true },
        selectors: { images: { container: '#reader', item: 'img.recovery-page', srcAttr: 'data-src' } },
        sourceDiscoveryId: 'browser-target-recovery-e2e', promotedAt: new Date().toISOString(),
    };
}

async function registerRecoveryAdapter(request: any, chapterUrl: string) {
    return request.post('/__test/register-fixture-replay-generated-adapter', {
        data: recoveryManifest(chapterUrl),
    });
}

async function createRecoveryContext(chapterUrl: string): Promise<RecoveryContext> {
    const firstStore = new E2eClientStateStore();
    const firstDriver = new E2eExistingTabDriver(chapterUrl, true);
    const firstClient = createExistingTabClient(firstStore, firstDriver, 'restart-a');
    await firstClient.enroll({ name: 'E2E Browser Client Recovery' });
    const firstConnection = await firstClient.connect();
    const firstResource = await firstClient.registerResource({ kind: 'tab', url: chapterUrl, localHandle: 1 });
    return { chapterUrl, firstStore, firstDriver, firstClient, firstConnection, firstResource };
}

function recoveryTarget(connection: any, resource: any) {
    return { mode: 'existing-tab', workerId: connection.workerId, resourceId: resource.resourceId };
}

async function occupyRecoveryWorker(request: any, context: RecoveryContext): Promise<void> {
    context.busyRequest = request.post('/api/adapters/chapter-images', {
        data: {
            url: context.chapterUrl, adapterId: 'browser-target-recovery-e2e',
            browserTarget: recoveryTarget(context.firstConnection, context.firstResource),
        },
        timeout: 0,
    });
    await expect.poll(async () => browserWorkerStatus(request, context.firstConnection.workerId)).toBe('busy');
}

async function browserWorkerStatus(request: any, workerId: string): Promise<string | undefined> {
    const response = await request.get('/api/browser-workers');
    const workers = (await response.json()).data.workers;
    return workers.find((worker: any) => worker.workerId === workerId)?.status;
}

async function queueRecoveryTask(request: any, context: RecoveryContext): Promise<string> {
    const create = await request.post('/api/tasks', {
        data: {
            url: context.chapterUrl, adapterId: 'browser-target-recovery-e2e', mode: 'chapters',
            chapterUrls: [context.chapterUrl],
            browserTarget: recoveryTarget(context.firstConnection, context.firstResource),
        },
    });
    expect(create.status()).toBe(201);
    const taskId = (await create.json()).data.taskId;
    await waitForTask(request, taskId, 'waiting_for_browser_worker');
    return taskId;
}

async function restartRecoveryClient(context: RecoveryContext): Promise<void> {
    await context.firstClient.disconnect();
    context.firstDriver.releaseCommands();
    await context.busyRequest?.catch(() => undefined);
    context.busyRequest = undefined;
    const savedState = await context.firstStore.get();
    expect(savedState).toBeDefined();
    const secondDriver = new E2eExistingTabDriver(context.chapterUrl, false);
    context.secondClient = createExistingTabClient(new E2eClientStateStore(savedState), secondDriver, 'restart-b');
    context.secondConnection = await context.secondClient.connect();
    context.secondResource = await context.secondClient.registerResource({
        kind: 'tab', url: context.chapterUrl, localHandle: 1,
    });
    expect(context.secondConnection.workerId).not.toBe(context.firstConnection.workerId);
}

async function rebindRecoveryTarget(request: any, context: RecoveryContext): Promise<void> {
    const recovery = await request.post(`/api/tasks/${context.taskId}/rebind-browser-target`, {
        data: {
            expectedBrowserTarget: recoveryTarget(context.firstConnection, context.firstResource),
            browserTarget: recoveryTarget(context.secondConnection, context.secondResource),
        },
    });
    expect(recovery.status()).toBe(200);
    expect((await recovery.json()).data.recovery.idempotent).toBe(false);
}

async function expectRecoveredTask(request: any, context: RecoveryContext): Promise<void> {
    const completed = await waitForTask(request, context.taskId!, 'completed');
    expect(completed.task.browserTarget).toEqual(recoveryTarget(context.secondConnection, context.secondResource));
    expect(completed.events).toEqual([
        expect.objectContaining({ type: 'task:browser_target_rebound' }),
    ]);
    expect(completed.result.downloadedImages).toBe(1);
}

async function closeRecoveryContext(context: RecoveryContext): Promise<void> {
    context.firstDriver.releaseCommands();
    await context.busyRequest?.catch(() => undefined);
    await context.firstClient.close().catch(() => undefined);
    await context.secondClient?.close().catch(() => undefined);
}

function ComicCrawlerE2ETestMatchedAdapterHandoff() {
    matchedAdapterHandoffTestGroup1();
}

async function ComicCrawlerE2ETestREL01QueueSlot({ request }) {
    test.setTimeout(90000);
    const challengeUrl1 = 'http://127.0.0.1:4173/api/fixtures/reliability-challenge-chapter-1';
    const challengeUrl2 = 'http://127.0.0.1:4173/api/fixtures/reliability-challenge-chapter-2';
    const okUrl = 'http://127.0.0.1:4173/api/fixtures/reliability-ok-chapter-3';
    const [task1, task2] = await test.step('1. 建立 challenge 工作', async () => [
        await createReliabilityTask(request, challengeUrl1, 10),
        await createReliabilityTask(request, challengeUrl2, 9),
    ]);
    const task3 = await test.step('2. 建立正常工作', async () => (createReliabilityTask(request, okUrl, 0)));
    const [waiting1, waiting2] = await test.step('3. 等待 challenge 工作', async () => Promise.all([
        waitForTask(request, task1, 'waiting_verification'),
        waitForTask(request, task2, 'waiting_verification'),
    ]));
    await expectReliabilityQueue(request, waiting1, waiting2);
    await expectReliabilityTask(request, task3);
    await cleanupReliabilityHandoffs(request, waiting1, waiting2);
}

async function expectReliabilityQueue(request: any, first: any, second: any): Promise<void> {
    await test.step('4. 檢查 queue 狀態', async () => {
        expect(first.result.challengeDiscoveryId).toBeDefined();
        expect(second.result.challengeDiscoveryId).toBeDefined();
        const body = await (await request.get('/api/tasks')).json();
        expect(body.data.stats.waitingVerification).toBeGreaterThanOrEqual(2);
        expect(body.data.stats.running).toBe(0);
    });
}

async function expectReliabilityTask(request: any, taskId: string): Promise<void> {
    await test.step('5. 檢查正常工作', async () => {
        const completed = await waitForTask(request, taskId, 'completed');
        expect(completed.result.downloadedImages).toBe(2);
        expect(completed.checkpoint.completedImages).toBe(2);
        expect(completed.checkpoint.resumable).toBe(false);
    });
}

async function cleanupReliabilityHandoffs(request: any, ...tasks: any[]): Promise<void> {
    await test.step('6. 清理 handoff', async () => {
        for (const task of tasks) {
            const response = await request.delete(`/api/challenge-discovery/${task.result.challengeDiscoveryId}`);
            expect(response.status()).toBe(200);
        }
    });
}

async function ComicCrawlerE2ETestREL02Checkpoint({ request, page }) {
    test.setTimeout(90000);
    const challengeUrl = 'http://localhost:4173/api/fixtures/reliability-challenge-chapter-resume';
    let challengeDiscoveryId = '';
    const taskId = await test.step('1. 建立 challenge 工作', async () => (createReliabilityTask(request, challengeUrl, 10)));
    challengeDiscoveryId = await expectCheckpointWaiting(request, page, taskId);
    await completeReliabilityVerification(request, challengeUrl);
    await resumeReliabilityTask(request, taskId);
    await expectCheckpointCompleted(request, page, taskId);
    await test.step('6. 清理 handoff', async () => {
        expect((await request.delete(`/api/challenge-discovery/${challengeDiscoveryId}`)).status()).toBe(200);
    });
}

async function expectCheckpointWaiting(request: any, page: any, taskId: string): Promise<string> {
    return test.step('2. 檢查 checkpoint UI', async () => {
        const waiting = await waitForTask(request, taskId, 'waiting_verification');
        await page.goto(`/tasks/${taskId}`);
        await expect(page.getByTestId('task-verification-handoff')).toBeVisible();
        await expect(page.getByText('Resume checkpoint')).toBeVisible();
        return waiting.result.challengeDiscoveryId;
    });
}

async function completeReliabilityVerification(request: any, url: string): Promise<void> {
    await test.step('3. 完成人工驗證', async () => {
        const verify = await request.post('/__test/reliability/verify', { data: { url } });
        expect(verify.status()).toBe(200);
    });
}

async function resumeReliabilityTask(request: any, taskId: string): Promise<void> {
    await test.step('4. 恢復工作', async () => {
        expect((await request.post(`/api/tasks/${taskId}/resume`)).status()).toBe(200);
    });
}

async function expectCheckpointCompleted(request: any, page: any, taskId: string): Promise<void> {
    await test.step('5. 檢查完成狀態', async () => {
        const resumed = await waitForTask(request, taskId, 'completed');
        expect(resumed.result).toMatchObject({ totalImages: 2, downloadedImages: 2 });
        expect(resumed.checkpoint).toMatchObject({ completedImages: 2, resumable: false });
        await page.goto(`/tasks/${taskId}`);
        await expect(page.getByText('Completed images')).toBeVisible();
        await expect(page.getByText('This task can continue from the last saved image checkpoint.')).not.toBeVisible();
        await expect(page.locator('img[alt$=".jpg"], img[alt$=".png"]').first()).toBeVisible();
    });
}

async function ComicCrawlerE2ETestWEB02Handoff({ page, request }) {
    await page.goto('/');
    await page.getByTestId('task-mode-chapters').click();
    await page.getByTestId('chapter-url-input-0').fill('http://127.0.0.1:4173/api/fixtures/challenge-never-clears');
    await page.getByTestId('create-task-submit').click();
    const status = page.getByTestId('challenge-build-task-status');
    await expectHandoffStatus(status);
    const jobsResponse = await request.get('/api/challenge-discovery');
    const jobsBody = await jobsResponse.json();
    const job = jobsBody.data.jobs.find((candidate: {
        normalizedUrl: string;
    }) => candidate.normalizedUrl.includes('/api/fixtures/challenge-never-clears'));
    expect(job?.id).toBeDefined();
    expect((await request.delete(`/api/challenge-discovery/${job.id}`)).status()).toBe(200);
}

async function expectHandoffStatus(status: any): Promise<void> {
    await expect(status).toBeVisible();
    for (const text of ['Human verification handoff job created.', 'challenge_required',
        'Create Task only queues challenge or discovery work.']) {
        await expect(status).toContainText(text);
    }
    for (const text of ['Promote strategy', 'Open headed browser', 'Open in my browser',
        'Browser executable path', 'Create adapter from attached browser page',
        'HTML snapshot from your browser']) {
        await expect(status).not.toContainText(text);
    }
}

function ComicCrawlerE2ETestChallengeAdapter() {
    challengeAdapterTestGroup1();
}

async function ComicCrawlerE2ETestCFG02Browser({ page, request }) {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('browser-worker-wait-timeout-input').fill('120000');
    await page.getByTestId('browser-timeout-input').fill('45000');
    await page.getByTestId('browser-post-load-delay-input').fill('750');
    await page.getByTestId('settings-save-button').click();
    await expect.poll(async () => {
        const response = await request.get('/api/config');
        const body = await response.json();
        return body.data.browser;
    }).toMatchObject({
        timeout: 45000,
        workerWaitTimeoutMs: 120000,
        postLoadDelayMs: 750,
    });
}

async function ComicCrawlerE2ETestCFG03BrowserTransport({ request }) {
    const current = await request.get('/api/config');
    const config = (await current.json()).data;
    const response = await request.put('/api/config', {
        data: {
            browser: {
                ...config.browser,
                transport: { protocol: 'custom' },
            },
        },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Unrecognized key');
}
