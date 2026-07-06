import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:net';

test.describe('ComicCrawler E2E', () => {
  test('should return health check status', async ({ request }) => {
    const response = await request.get('/api/status');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.version).toBe('0.1.0');
    expect(body.data.adapters).toBeDefined();
    expect(body.data.adapters.loaded).toBeGreaterThanOrEqual(0);
  });

  test('should create a download task', async ({ request }) => {
    const response = await request.post('/api/tasks', {
      data: {
        url: 'https://kuronavi.one/manga/test',
        adapterId: 'kuronavi',
      },
    });

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.data.taskId).toBeDefined();
  });

  test('should list tasks (empty initially)', async ({ request }) => {
    const response = await request.get('/api/tasks');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.data.tasks).toBeDefined();
    expect(Array.isArray(body.data.tasks)).toBeTruthy();
  });

  test('should get config', async ({ request }) => {
    const response = await request.get('/api/config');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.download).toBeDefined();
    expect(body.data.server).toBeDefined();
  });

  test('should list adapters (empty initially)', async ({ request }) => {
    const response = await request.get('/api/adapters');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test('should return 404 for unknown routes', async ({ request }) => {
    const response = await request.get('/api/nonexistent');
    expect(response.status()).toBe(404);
  });

  test('should reject invalid task creation', async ({ request }) => {
    const response = await request.post('/api/tasks', {
      data: {
        url: '',
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('should return adapter details', async ({ request }) => {
    const response = await request.get('/api/adapters/kuronavi');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe('kuronavi');
    expect(body.data.parseMode).toBe('static');
  });

  test('should create an adapter build task when no adapter matches and selector discovery is not configured', async ({ request }) => {
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
  });

  test('should show adapter build configuration-required state in the WebUI', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('task-mode-chapters').click();
    await page.getByTestId('chapter-url-input-0').fill('https://unknown-ui-e2e.example/manga/demo/chapter-1');
    await page.getByTestId('create-task-submit').click();

    const status = page.getByTestId('adapter-build-task-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Adapter build task created.');
    await expect(status).toContainText('configuration_required');
    await expect(status).toContainText('Open Settings');
  });

  test('should preview which adapter will be used for the entered URL in the WebUI', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('task-mode-chapters').click();
    await page.getByTestId('chapter-url-input-0').fill('https://kuronavi.one/manga/demo/chapter-1');

    const preview = page.getByTestId('adapter-resolution-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Kuronavi E2E Fixture');
    await expect(preview).toContainText('kuronavi');
    await expect(preview).toContainText('Images O');
  });

  test('should discover, promote, and use a new chapter-only dynamic adapter', async ({ request }) => {
    await configureSelectorDiscovery(request);
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/discovery-chapter';

    const discoveryResponse = await request.post('/api/tasks', {
      data: {
        url: chapterUrl,
        mode: 'chapters',
        chapterUrls: [chapterUrl],
      },
    });

    expect(discoveryResponse.status()).toBe(202);
    const discoveryBody = await discoveryResponse.json();
    expect(discoveryBody.data.kind).toBe('discoveryQueued');
    expect(discoveryBody.data.reason).toBe('adapter_not_found');
    const discoveryId = discoveryBody.data.discoveryId;

    const job = await waitForDiscovery(request, discoveryId, 'awaiting_review');
    expect(job.status).toBe('awaiting_review');
    expect(job.parsedCandidate.adapterId).toBe('discovery-e2e');
    expect(job.parsedCandidate.selectors.images.item).toBe('img.page-image');

    const promoteResponse = await request.post(`/api/selector-discovery/${discoveryId}/promote`);
    expect(promoteResponse.status()).toBe(200);
    const promoted = await promoteResponse.json();
    expect(promoted.data.adapterId).toBe('discovery-e2e');
    expect(promoted.data.capabilities).toMatchObject({ verification: true, metadata: false, chapterImages: true });

    const adapterResponse = await request.get('/api/adapters/discovery-e2e');
    expect(adapterResponse.status()).toBe(200);
    const adapterBody = await adapterResponse.json();
    expect(adapterBody.data.parseMode).toBe('dynamic');
    expect(adapterBody.data.capabilities).toMatchObject({ verification: true, metadata: false, chapterImages: true });

    const response = await request.post('/api/tasks', {
      data: {
        url: chapterUrl,
        mode: 'chapters',
        chapterUrls: [chapterUrl],
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    const taskId = body.data.taskId;
    expect(taskId).toBeDefined();

    const completed = await waitForTask(request, taskId, 'completed');
    expect(completed.task.status).toBe('completed');
    expect(completed.result.totalImages).toBe(1);
    expect(completed.result.downloadedImages).toBe(1);
  });

  test('should create chapter-only discovery from a user HTML snapshot', async ({ request }) => {
    await configureSelectorDiscovery(request);
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/snapshot-chapter';

    const response = await request.post('/api/selector-discovery/snapshot', {
      data: {
        url: chapterUrl,
        target: 'chapter-only',
        html: `<!doctype html>
          <html>
            <head><title>Snapshot Chapter</title></head>
            <body>
              <main id="reader">
                <img class="page-image" data-src="/api/fixtures/discovery-image.jpg" />
              </main>
            </body>
          </html>`,
      },
    });

    expect(response.status()).toBe(202);
    const body = await response.json();
    const discoveryId = body.data.id;
    expect(body.data.inputSource).toBe('html-snapshot');

    const job = await waitForDiscovery(request, discoveryId, 'awaiting_review');
    expect(job.status).toBe('awaiting_review');
    expect(job.target).toBe('chapter-only');
    expect(job.phase1Markdown).toContain('Snapshot source: user-provided rendered chapter HTML');
    expect(job.parsedCandidate.selectors.images.item).toBe('img.page-image');
  });

  test('should create chapter-only discovery from an attached local CDP browser page', async ({ request }) => {
    test.setTimeout(90000);
    await configureSelectorDiscovery(request);
    const cdpPort = await getFreePort();
    const browser = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${cdpPort}`],
    });
    try {
      await waitForCdpEndpoint(cdpPort);
      const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/discovery-chapter';
      const page = await browser.newPage();
      await page.goto(chapterUrl);
      await page.waitForSelector('#reader img', { state: 'attached' });

      const challenge = await request.post('/api/challenge-discovery', {
        data: {
          url: chapterUrl,
        },
        timeout: 10000,
      });
      expect(challenge.status()).toBe(202);
      const challengeBody = await challenge.json();

      const response = await request.post(`/api/challenge-discovery/${challengeBody.data.id}/create-selector-discovery-from-cdp`, {
        data: {
          cdpUrl: `http://127.0.0.1:${cdpPort}`,
        },
        timeout: 15000,
      });
      expect(response.status()).toBe(202);
      const body = await response.json();
      expect(body.data.challenge.status).toBe('ready');
      expect(body.data.discovery.inputSource).toBe('html-snapshot');
      expect(body.data.discovery.target).toBe('chapter-only');

      const job = await waitForDiscovery(request, body.data.discovery.id, 'awaiting_review');
      expect(job.parsedCandidate.selectors.images.item).toBe('img.page-image');
    } finally {
      await browser.close();
    }
  });

  test('should run a crawl with a self-AO generated chapter-only adapter without AO', async ({ request }) => {
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/self-ao-generated-chapter';
    const register = await request.post('/__test/register-self-ao-generated-adapter', {
      data: {
        adapterId: 'self-ao-generated-e2e',
        name: 'Self-AO Generated E2E',
        domains: ['127.0.0.1'],
        urlPatterns: ['http://127.0.0.1:4173/api/fixtures/self-ao-generated-*'],
        capabilities: { verification: true, metadata: false, chapterImages: true },
        selectors: {
          images: {
            container: '#reader',
            item: 'img.self-ao-page',
            srcAttr: 'data-src',
          },
        },
        sourceDiscoveryId: 'self-ao-generated-e2e',
        promotedAt: new Date().toISOString(),
      },
    });
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
  });

  test('should create and promote a challenge strategy when an unknown URL is blocked by a browser challenge', async ({ request }) => {
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
    const job = await waitForChallengeDiscovery(request, body.data.challengeDiscoveryId, 'strategy_awaiting_review');
    expect(job.candidateSource).toContain('export const strategy');
    expect(job.validation.valid).toBe(true);

    const promote = await request.post(`/api/challenge-discovery/${job.id}/promote`);
    expect(promote.status()).toBe(200);
    const promoted = await promote.json();
    expect(promoted.data.strategyId).toBe('127-0-0-1-challenge');
  });

  test('should create verification handoff when a matched dynamic adapter throws a challenge error while crawling', async ({ request, page }) => {
    test.setTimeout(90000);
    const challengeUrl = 'http://127-0-0-1.nip.io:4173/api/fixtures/challenge-never-clears?matched-adapter=1';
    const register = await request.post('/__test/register-self-ao-generated-adapter', {
      data: {
        adapterId: 'matched-challenge-e2e',
        name: 'Matched Challenge E2E',
        domains: ['127-0-0-1.nip.io'],
        urlPatterns: ['http://127-0-0-1.nip.io:4173/api/fixtures/challenge-never-clears?matched-adapter=1'],
        capabilities: { verification: true, metadata: false, chapterImages: true },
        selectors: {
          images: {
            container: '#reader',
            item: 'img.page-image',
            srcAttr: 'data-src',
          },
        },
        sourceDiscoveryId: 'matched-challenge-e2e',
        promotedAt: new Date().toISOString(),
      },
    });
    expect(register.status()).toBe(200);

    const response = await request.post('/api/tasks', {
      data: {
        url: challengeUrl,
        mode: 'chapters',
        chapterUrls: [challengeUrl],
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.data.kind).toBe('taskCreated');
    const waiting = await waitForTask(request, body.data.taskId, 'waiting_verification');
    expect(waiting.result.challengeDiscoveryId).toBeDefined();
    expect(waiting.result.error).toContain('Human verification is required');

    await page.goto(`/tasks/${body.data.taskId}`);
    const handoff = page.getByTestId('task-verification-handoff');
    await expect(handoff).toBeVisible();
    await expect(handoff).toContainText('Human verification required');
    await expect(handoff).toContainText(waiting.result.challengeDiscoveryId);
    await expect(handoff).toContainText('Open browser for verification');
    await expect(page.getByTestId('verification-browser-path-input')).toBeVisible();
    await expect(page.getByTestId('verification-browser-profile-select')).toHaveCount(0);
    await expect(handoff).not.toContainText('Promote strategy');
    await expect(handoff).not.toContainText('Open headed browser');
    await expect(handoff).not.toContainText('Open in my browser');
    await expect(handoff).not.toContainText('Inspect via CDP');
    await expect(handoff).not.toContainText('Create adapter from attached browser page');

    await page.route(`**/api/challenge-discovery/${waiting.result.challengeDiscoveryId}`, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Challenge discovery job not found.' }),
      });
    });
    await page.reload();
    await expect(page.getByTestId('challenge-job-unavailable-message')).toContainText('Click Continue to recreate the handoff');
    await expect(page.getByTestId('open-verification-browser-button')).toHaveCount(0);
  });

  test('should release queue slots for verification tasks and resume from checkpoint after verification', async ({ request, page }) => {
    test.setTimeout(90000);
    const challengeUrl1 = 'http://127.0.0.1:4173/api/fixtures/reliability-challenge-chapter-1';
    const challengeUrl2 = 'http://127.0.0.1:4173/api/fixtures/reliability-challenge-chapter-2';
    const okUrl = 'http://127.0.0.1:4173/api/fixtures/reliability-ok-chapter-3';

    const task1 = await createReliabilityTask(request, challengeUrl1, 10);
    const task2 = await createReliabilityTask(request, challengeUrl2, 9);
    const task3 = await createReliabilityTask(request, okUrl, 0);

    const waiting1 = await waitForTask(request, task1, 'waiting_verification');
    const waiting2 = await waitForTask(request, task2, 'waiting_verification');
    const completed3 = await waitForTask(request, task3, 'completed');

    expect(waiting1.result.challengeDiscoveryId).toBeDefined();
    expect(waiting2.result.challengeDiscoveryId).toBeDefined();
    expect(completed3.result.downloadedImages).toBe(2);
    expect(completed3.checkpoint.completedImages).toBe(2);
    expect(completed3.checkpoint.resumable).toBe(false);

    const statsResponse = await request.get('/api/tasks');
    const statsBody = await statsResponse.json();
    expect(statsBody.data.stats.waitingVerification).toBeGreaterThanOrEqual(2);
    expect(statsBody.data.stats.running).toBe(0);

    await page.goto(`/tasks/${task1}`);
    await expect(page.getByTestId('task-verification-handoff')).toBeVisible();
    await expect(page.getByText('Resume checkpoint')).toBeVisible();

    const verify = await request.post('/__test/reliability/verify', {
      data: { url: challengeUrl1 },
    });
    expect(verify.status()).toBe(200);

    const resume = await request.post(`/api/tasks/${task1}/resume`);
    expect(resume.status()).toBe(200);

    const resumed = await waitForTask(request, task1, 'completed');
    expect(resumed.result.totalImages).toBe(2);
    expect(resumed.result.downloadedImages).toBe(2);
    expect(resumed.checkpoint.completedImages).toBe(2);
    expect(resumed.checkpoint.resumable).toBe(false);

    await page.goto(`/tasks/${task1}`);
    await expect(page.getByText('Resume checkpoint')).toBeVisible();
    await expect(page.getByText('Completed images')).toBeVisible();
    await expect(page.getByText('This task can continue from the last saved image checkpoint.')).not.toBeVisible();
    await expect(page.locator('img[alt$=".jpg"], img[alt$=".png"]').first()).toBeVisible();
  });

  test('should show browser challenge strategy task in the WebUI', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('task-mode-chapters').click();
    await page.getByTestId('chapter-url-input-0').fill('http://127.0.0.1:4173/api/fixtures/challenge-never-clears');
    await page.getByTestId('create-task-submit').click();

    const status = page.getByTestId('challenge-build-task-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Browser challenge strategy task created.');
    await expect(status).toContainText('strategy_awaiting_review');
    await expect(status).toContainText('Create Task only queues challenge/discovery work.');
    await expect(status).not.toContainText('Promote strategy');
    await expect(status).not.toContainText('Open headed browser');
    await expect(status).not.toContainText('Open in my browser');
    await expect(status).not.toContainText('Inspect via CDP');
    await expect(status).not.toContainText('Create adapter from attached browser page');
    await expect(status).not.toContainText('HTML snapshot from your browser');
  });

  test('should use challenge handling before selector discovery and complete a crawl', async ({ request }) => {
    await configureSelectorDiscovery(request);
    const chapterUrl = 'http://localhost:4173/api/fixtures/challenge-clears';

    const discoveryResponse = await request.post('/api/tasks', {
      data: {
        url: chapterUrl,
        mode: 'chapters',
        chapterUrls: [chapterUrl],
      },
    });

    expect(discoveryResponse.status()).toBe(202);
    const discoveryBody = await discoveryResponse.json();
    expect(discoveryBody.data.kind).toBe('discoveryQueued');
    const discoveryId = discoveryBody.data.discoveryId;
    const job = await waitForDiscovery(request, discoveryId, 'awaiting_review');
    expect(job.parsedCandidate.selectors.images.item).toBe('img.page-image');

    const promoteResponse = await request.post(`/api/selector-discovery/${discoveryId}/promote`);
    expect(promoteResponse.status()).toBe(200);

    const taskResponse = await request.post('/api/tasks', {
      data: {
        url: chapterUrl,
        mode: 'chapters',
        chapterUrls: [chapterUrl],
      },
    });
    expect(taskResponse.status()).toBe(201);
    const taskBody = await taskResponse.json();
    const completed = await waitForTask(request, taskBody.data.taskId, 'completed');
    expect(completed.result.totalImages).toBe(1);
    expect(completed.result.downloadedImages).toBe(1);
  });

  test('should save headless browser crawler settings from the WebUI', async ({ page, request }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('browser-mode-select').selectOption('headless');
    await page.getByTestId('browser-wait-until-select').selectOption('load');
    await page.getByTestId('browser-timeout-input').fill('45000');
    await page.getByTestId('browser-wait-selector-input').fill('#reader img');
    await page.getByTestId('browser-challenge-wait-input').fill('60000');
    await page.getByTestId('browser-channel-input').fill('chrome');
    await page.getByTestId('browser-storage-state-input').fill('D:/tmp/comiccrawler-storage-state.json');
    await page.getByTestId('browser-user-data-dir-input').fill('D:/tmp/comiccrawler-profile');
    await page.getByTestId('browser-handoff-mode-input').selectOption('cdp');
    await page.getByTestId('browser-handoff-cdp-url-input').fill('http://127.0.0.1:9222');
    await page.getByTestId('settings-save-button').click();

    await expect.poll(async () => {
      const response = await request.get('/api/config');
      const body = await response.json();
      return body.data.browser;
    }).toMatchObject({
      mode: 'headless',
      waitUntil: 'load',
      timeout: 45000,
      waitForSelector: '#reader img',
      challengeAutoAttempt: true,
      challengeWaitMs: 60000,
      channel: 'chrome',
      storageStatePath: 'D:/tmp/comiccrawler-storage-state.json',
      userDataDir: 'D:/tmp/comiccrawler-profile',
      handoff: {
        mode: 'cdp',
        cdpUrl: 'http://127.0.0.1:9222',
      },
    });
  });

  test('should reject remote CDP browser handoff endpoints', async ({ request }) => {
    const response = await request.post('/api/challenge-discovery/cdp/test', {
      data: {
        cdpUrl: 'http://example.com:9222',
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('localhost');
  });

  test('should reject remote CDP endpoint when creating selector discovery from an attached browser page', async ({ request }) => {
    const create = await request.post('/api/challenge-discovery', {
      data: {
        url: 'http://127.0.0.1:4173/api/fixtures/challenge-never-clears',
      },
    });
    expect(create.status()).toBe(202);
    const created = await create.json();

    const response = await request.post(`/api/challenge-discovery/${created.data.id}/create-selector-discovery-from-cdp`, {
      data: {
        cdpUrl: 'http://example.com:9222',
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('localhost');
  });
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
    data: {
      aoBaseUrl: 'http://127.0.0.1:4173/__ao',
      model: 'my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive',
      providerDocument: {
        provider: {
          my_local_lmstudio: {
            name: 'my local lmstudio',
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://host.docker.internal:25555/v1',
              apiKey: 'nopassword',
            },
            models: {
              'gemma-4-e4b-uncensored-hauhaucs-aggressive': {
                name: 'gemma-4-e4b-uncensored-hauhaucs-aggressive',
              },
            },
          },
        },
      },
    },
  });
  expect(response.status()).toBe(200);
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to allocate a free TCP port.'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForCdpEndpoint(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/json/version`;
  const startedAt = Date.now();
  let latestError: unknown;
  while (Date.now() - startedAt < 10000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      latestError = new Error(`CDP endpoint returned ${response.status}`);
    } catch (error) {
      latestError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for CDP endpoint ${url}: ${latestError instanceof Error ? latestError.message : String(latestError)}`);
}
