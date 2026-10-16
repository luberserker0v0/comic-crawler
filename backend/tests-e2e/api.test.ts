import { test, expect } from '@playwright/test';

test.describe('ComicCrawler E2E', () => {
  test.beforeEach(async ({ request }) => {
    const response = await request.put('/api/config', {
      data: { i18n: { language: 'en-US', fallback: 'en' } },
    });
    expect(response.ok()).toBeTruthy();
  });

  test('API-01 服務狀態', async ({ request }) => {
    const response = await request.get('/api/status');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.version).toBe('0.1.0');
    expect(body.data.adapters).toBeDefined();
    expect(body.data.adapters.loaded).toBeGreaterThanOrEqual(0);
  });

  test('TASK-01 建立下載工作', async ({ request }) => {
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

  test('TASK-02 讀取工作清單', async ({ request }) => {
    const response = await request.get('/api/tasks');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.data.tasks).toBeDefined();
    expect(Array.isArray(body.data.tasks)).toBeTruthy();
  });

  test('CFG-01 讀取設定', async ({ request }) => {
    const response = await request.get('/api/config');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.download).toBeDefined();
    expect(body.data.server).toBeDefined();
  });

  test('ADP-01 讀取 adapter 清單', async ({ request }) => {
    const response = await request.get('/api/adapters');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test('API-02 拒絕未知路由', async ({ request }) => {
    const response = await request.get('/api/nonexistent');
    expect(response.status()).toBe(404);
  });

  test('TASK-03 拒絕無效工作', async ({ request }) => {
    const response = await request.post('/api/tasks', {
      data: {
        url: '',
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('ADP-02 查看 adapter 詳情', async ({ request }) => {
    const response = await request.get('/api/adapters/kuronavi');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe('kuronavi');
    expect(body.data.parseMode).toBe('playwright');
  });

  test('DISC-01 缺少 discovery 設定', async ({ request }) => {
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

  test('WEB-01 顯示 discovery 設定錯誤', async ({ page }) => {
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

  test('ADP-03 預覽 adapter', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('task-mode-chapters').click();
    await page.getByTestId('chapter-url-input-0').fill('https://kuronavi.one/manga/demo/chapter-1');

    const preview = page.getByTestId('adapter-resolution-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Kuronavi E2E Fixture');
    await expect(preview).toContainText('kuronavi');
    await expect(preview).toContainText('Images O');
  });

  test('ADP-04 測試 adapter 函式', async ({ page }) => {
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
  });

  test.describe.serial('新站點 chapter adapter', () => {
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/discovery-chapter';
    let discoveryId = '';

    test('DISC-04 產生 adapter', async ({ request }) => {
      await test.step('1. 設定 selector discovery', async () => {
        await configureSelectorDiscovery(request);
      });

      const discoveryResponse = await test.step('2. 送出未知網址', async () => request.post('/api/tasks', {
        data: {
          url: chapterUrl,
          mode: 'chapters',
          chapterUrls: [chapterUrl],
        },
      }));

      await test.step('3. 檢查排程結果', async () => {
        expect(discoveryResponse.status()).toBe(202);
        const discoveryBody = await discoveryResponse.json();
        expect(discoveryBody.data.kind).toBe('discoveryQueued');
        expect(discoveryBody.data.reason).toBe('adapter_not_found');
        discoveryId = discoveryBody.data.discoveryId;
      });

      await test.step('4. 檢查 adapter 草稿', async () => {
        const job = await waitForDiscovery(request, discoveryId, 'awaiting_review');
        expect(job.adapterImplementationTs).toContain('class E2EChapterImagesCapability');
        expect(job.implementationValidation.valid).toBe(true);
      });
    });

    test('DISC-05 發佈 adapter', async ({ request }) => {
      const promoteResponse = await test.step('1. 發佈 adapter', async () => (
        request.post(`/api/selector-discovery/${discoveryId}/promote`)
      ));

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
    });

    test('CRAWL-01 使用新 adapter', async ({ request }) => {
      const response = await test.step('1. 建立章節工作', async () => request.post('/api/tasks', {
        data: {
          url: chapterUrl,
          mode: 'chapters',
          chapterUrls: [chapterUrl],
        },
      }));

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
    });
  });

  test('DISC-02 使用 HTML snapshot', async ({ request }) => {
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
    expect(job.adapterImplementationTs).toContain("$('img.page-image')");
  });

  test('DISC-03 使用遠端頁面', async ({ request }) => {
    test.setTimeout(90000);
    await configureSelectorDiscovery(request);
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/discovery-chapter';

    const challenge = await request.post('/api/challenge-discovery', {
      data: {
        url: chapterUrl,
      },
      timeout: 10000,
    });
    expect(challenge.status()).toBe(202);
    const challengeBody = await challenge.json();
    const open = await request.post(`/api/challenge-discovery/${challengeBody.data.id}/open-browser`);
    expect(open.status()).toBe(200);

    const response = await request.post(`/api/challenge-discovery/${challengeBody.data.id}/create-selector-discovery-from-remote`, {
      timeout: 15000,
    });
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(202);
    expect(body.data.challenge.status).toBe('ready');
    expect(body.data.discovery.inputSource).toBe('html-snapshot');
    expect(body.data.discovery.target).toBe('chapter-only');

    expect(body.data.discovery.status).toBe('queued');
  });

  test('CRAWL-02 使用 fixture adapter', async ({ request }) => {
    const chapterUrl = 'http://127.0.0.1:4173/api/fixtures/fixture-replay-generated-chapter';
    const register = await request.post('/__test/register-fixture-replay-generated-adapter', {
      data: {
        adapterId: 'fixture-replay-generated-e2e',
        name: 'Fixture Replay Generated E2E',
        domains: ['127.0.0.1'],
        urlPatterns: ['http://127.0.0.1:4173/api/fixtures/fixture-replay-generated-*'],
        capabilities: { verification: true, metadata: false, chapterImages: true },
        selectors: {
          images: {
            container: '#reader',
            item: 'img.fixture-replay-page',
            srcAttr: 'data-src',
          },
        },
        sourceDiscoveryId: 'fixture-replay-generated-e2e',
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

  test('BP-04 建立未知站點 handoff', async ({ request }) => {
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
  });

  test.describe.serial('matched adapter handoff', () => {
    const challengeUrl = 'http://127-0-0-1.nip.io:4173/api/fixtures/challenge-never-clears?matched-adapter=1';
    let taskId = '';
    let challengeDiscoveryId = '';

    test('BP-05 建立 adapter handoff', async ({ request }) => {
      test.setTimeout(90000);
      const register = await test.step('1. 註冊測試 adapter', async () => request.post('/__test/register-fixture-replay-generated-adapter', {
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
      }));
      expect(register.status()).toBe(200);

      const response = await test.step('2. 建立章節工作', async () => request.post('/api/tasks', {
        data: {
          url: challengeUrl,
          mode: 'chapters',
          chapterUrls: [challengeUrl],
        },
      }));

      await test.step('3. 檢查建立結果', async () => {
        expect(response.status()).toBe(201);
        const body = await response.json();
        expect(body.data.kind).toBe('taskCreated');
        taskId = body.data.taskId;
      });

      await test.step('4. 等待 handoff', async () => {
        const waiting = await waitForTask(request, taskId, 'waiting_verification');
        challengeDiscoveryId = waiting.result.challengeDiscoveryId;
        expect(challengeDiscoveryId).toBeDefined();
        expect(waiting.result.error).toContain('Human verification is required');
      });
    });

    test('WEB-03 顯示 remote handoff', async ({ page }) => {
      await test.step('1. 開啟工作詳情', async () => {
        await page.goto(`/tasks/${taskId}`);
      });

      const handoff = page.getByTestId('task-verification-handoff');
      await test.step('2. 檢查 handoff 資訊', async () => {
        await expect(handoff).toBeVisible();
        await expect(handoff).toContainText('Human verification required');
        await expect(handoff).toContainText(challengeDiscoveryId);
        await expect(handoff).toContainText(/Open browser for verification|Reopen browser for verification/);
      });

      await test.step('3. 檢查舊欄位已移除', async () => {
        await expect(page.getByTestId('verification-browser-path-input')).toHaveCount(0);
        await expect(page.getByTestId('verification-browser-profile-select')).toHaveCount(0);
        await expect(handoff).not.toContainText('Promote strategy');
        await expect(handoff).not.toContainText('Open headed browser');
        await expect(handoff).not.toContainText('Open in my browser');
        await expect(handoff).not.toContainText('Browser executable path');
        await expect(handoff).not.toContainText('Create adapter from attached browser page');
      });
    });

    test('WEB-04 顯示遺失的 handoff', async ({ page, request }) => {
      await test.step('1. 模擬 handoff 遺失', async () => {
        await page.route(`**/api/challenge-discovery/${challengeDiscoveryId}`, async (route) => {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Challenge discovery job not found.' }),
          });
        });
      });

      await test.step('2. 開啟工作詳情', async () => {
        await page.goto(`/tasks/${taskId}`);
      });

      await test.step('3. 檢查恢復提示', async () => {
        await expect(page.getByTestId('challenge-job-unavailable-message')).toContainText('Continue to recreate it');
        await expect(page.getByTestId('open-verification-browser-button')).toHaveCount(0);
      });

      await test.step('4. 清理 handoff', async () => {
        expect((await request.delete(`/api/challenge-discovery/${challengeDiscoveryId}`)).status()).toBe(200);
      });
    });
  });

  test('REL-01 釋放等待中的 queue slot', async ({ request }) => {
    test.setTimeout(90000);
    const challengeUrl1 = 'http://127.0.0.1:4173/api/fixtures/reliability-challenge-chapter-1';
    const challengeUrl2 = 'http://127.0.0.1:4173/api/fixtures/reliability-challenge-chapter-2';
    const okUrl = 'http://127.0.0.1:4173/api/fixtures/reliability-ok-chapter-3';

    const [task1, task2] = await test.step('1. 建立 challenge 工作', async () => [
      await createReliabilityTask(request, challengeUrl1, 10),
      await createReliabilityTask(request, challengeUrl2, 9),
    ]);

    const task3 = await test.step('2. 建立正常工作', async () => (
      createReliabilityTask(request, okUrl, 0)
    ));

    const [waiting1, waiting2] = await test.step('3. 等待 challenge 工作', async () => Promise.all([
      waitForTask(request, task1, 'waiting_verification'),
      waitForTask(request, task2, 'waiting_verification'),
    ]));

    await test.step('4. 檢查 queue 狀態', async () => {
      expect(waiting1.result.challengeDiscoveryId).toBeDefined();
      expect(waiting2.result.challengeDiscoveryId).toBeDefined();
      const statsResponse = await request.get('/api/tasks');
      const statsBody = await statsResponse.json();
      expect(statsBody.data.stats.waitingVerification).toBeGreaterThanOrEqual(2);
      expect(statsBody.data.stats.running).toBe(0);
    });

    await test.step('5. 檢查正常工作', async () => {
      const completed3 = await waitForTask(request, task3, 'completed');
      expect(completed3.result.downloadedImages).toBe(2);
      expect(completed3.checkpoint.completedImages).toBe(2);
      expect(completed3.checkpoint.resumable).toBe(false);
    });

    await test.step('6. 清理 handoff', async () => {
      expect((await request.delete(`/api/challenge-discovery/${waiting1.result.challengeDiscoveryId}`)).status()).toBe(200);
      expect((await request.delete(`/api/challenge-discovery/${waiting2.result.challengeDiscoveryId}`)).status()).toBe(200);
    });
  });

  test('REL-02 從 checkpoint 恢復', async ({ request, page }) => {
    test.setTimeout(90000);
    const challengeUrl = 'http://localhost:4173/api/fixtures/reliability-challenge-chapter-resume';
    let challengeDiscoveryId = '';
    const taskId = await test.step('1. 建立 challenge 工作', async () => (
      createReliabilityTask(request, challengeUrl, 10)
    ));

    await test.step('2. 檢查 checkpoint UI', async () => {
      const waiting = await waitForTask(request, taskId, 'waiting_verification');
      challengeDiscoveryId = waiting.result.challengeDiscoveryId;
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId('task-verification-handoff')).toBeVisible();
      await expect(page.getByText('Resume checkpoint')).toBeVisible();
    });

    await test.step('3. 完成人工驗證', async () => {
      const verify = await request.post('/__test/reliability/verify', {
        data: { url: challengeUrl },
      });
      expect(verify.status()).toBe(200);
    });

    await test.step('4. 恢復工作', async () => {
      const resume = await request.post(`/api/tasks/${taskId}/resume`);
      expect(resume.status()).toBe(200);
    });

    await test.step('5. 檢查完成狀態', async () => {
      const resumed = await waitForTask(request, taskId, 'completed');
      expect(resumed.result.totalImages).toBe(2);
      expect(resumed.result.downloadedImages).toBe(2);
      expect(resumed.checkpoint.completedImages).toBe(2);
      expect(resumed.checkpoint.resumable).toBe(false);

      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByText('Completed images')).toBeVisible();
      await expect(page.getByText('This task can continue from the last saved image checkpoint.')).not.toBeVisible();
      await expect(page.locator('img[alt$=".jpg"], img[alt$=".png"]').first()).toBeVisible();
    });

    await test.step('6. 清理 handoff', async () => {
      expect((await request.delete(`/api/challenge-discovery/${challengeDiscoveryId}`)).status()).toBe(200);
    });
  });

  test('WEB-02 顯示 handoff 狀態', async ({ page, request }) => {
    await page.goto('/');
    await page.getByTestId('task-mode-chapters').click();
    await page.getByTestId('chapter-url-input-0').fill('http://127.0.0.1:4173/api/fixtures/challenge-never-clears');
    await page.getByTestId('create-task-submit').click();

    const status = page.getByTestId('challenge-build-task-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Human verification handoff job created.');
    await expect(status).toContainText('challenge_required');
    await expect(status).toContainText('Create Task only queues challenge or discovery work.');
    await expect(status).not.toContainText('Promote strategy');
    await expect(status).not.toContainText('Open headed browser');
    await expect(status).not.toContainText('Open in my browser');
    await expect(status).not.toContainText('Browser executable path');
    await expect(status).not.toContainText('Create adapter from attached browser page');
    await expect(status).not.toContainText('HTML snapshot from your browser');

    const jobsResponse = await request.get('/api/challenge-discovery');
    const jobsBody = await jobsResponse.json();
    const job = jobsBody.data.jobs.find((candidate: { normalizedUrl: string }) =>
      candidate.normalizedUrl.includes('/api/fixtures/challenge-never-clears')
    );
    expect(job?.id).toBeDefined();
    expect((await request.delete(`/api/challenge-discovery/${job.id}`)).status()).toBe(200);
  });

  test.describe.serial('challenge 後建立 adapter', () => {
    const chapterUrl = 'http://localhost:4173/api/fixtures/challenge-clears';
    let discoveryId = '';

    test('DISC-06 challenge 後開始 discovery', async ({ request }) => {
      await test.step('1. 設定 selector discovery', async () => {
        await configureSelectorDiscovery(request);
      });

      const discoveryResponse = await test.step('2. 送出 challenge 網址', async () => request.post('/api/tasks', {
        data: {
          url: chapterUrl,
          mode: 'chapters',
          chapterUrls: [chapterUrl],
        },
      }));

      await test.step('3. 檢查 discovery 結果', async () => {
        expect(discoveryResponse.status()).toBe(202);
        const discoveryBody = await discoveryResponse.json();
        expect(discoveryBody.data.kind).toBe('discoveryQueued');
        discoveryId = discoveryBody.data.discoveryId;
        const job = await waitForDiscovery(request, discoveryId, 'awaiting_review');
        expect(job.adapterImplementationTs).toContain("$('img.page-image')");
      });
    });

    test('DISC-07 發佈 challenge adapter', async ({ request }) => {
      const response = await test.step('1. 發佈 adapter', async () => (
        request.post(`/api/selector-discovery/${discoveryId}/promote`)
      ));

      await test.step('2. 檢查發佈結果', async () => {
        expect(response.status()).toBe(200);
      });
    });

    test('CRAWL-03 使用 challenge adapter', async ({ request }) => {
      const taskResponse = await test.step('1. 建立章節工作', async () => request.post('/api/tasks', {
        data: {
          url: chapterUrl,
          mode: 'chapters',
          chapterUrls: [chapterUrl],
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
    });
  });

  test('CFG-02 儲存 browser 設定', async ({ page, request }) => {
    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('browser-wait-until-select').selectOption('load');
    await page.getByTestId('browser-timeout-input').fill('45000');
    await page.getByTestId('browser-wait-selector-input').fill('#reader img');
    await page.getByTestId('browser-challenge-wait-input').fill('60000');
    await page.getByTestId('settings-save-button').click();

    await expect.poll(async () => {
      const response = await request.get('/api/config');
      const body = await response.json();
      return body.data.browser;
    }).toMatchObject({
      mode: 'remote',
      waitUntil: 'load',
      timeout: 45000,
      waitForSelector: '#reader img',
      challengeAutoAttempt: true,
      challengeWaitMs: 60000,
    });
  });

  test('CFG-03 拒絕手動 WS endpoint', async ({ request }) => {
    const current = await request.get('/api/config');
    const config = (await current.json()).data;
    const response = await request.put('/api/config', {
      data: {
        browser: {
          ...config.browser,
          remote: {
            ...config.browser.remote,
            wsEndpoint: 'wss://browser.example/ws/session-1',
          },
        },
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Unrecognized key');
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
