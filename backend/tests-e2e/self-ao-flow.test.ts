import { expect, test } from '@playwright/test';

test.describe('Self-AO generated adapter operational flow', () => {
  test('promotes the generated adapter artifact, then uses it from the WebUI to download images', async ({ page, request }) => {
    const chapterUrl = 'http://127-0-0-1.sslip.io:4173/api/fixtures/self-ao-promote-chapter';

    await configureSelectorDiscovery(request);

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

    const discoveryJob = await waitForDiscovery(request, discoveryId, 'awaiting_review');
    expect(discoveryJob.parsedCandidate.adapterId).toBe('self-ao-promote-e2e');
    expect(discoveryJob.parsedCandidate.selectors.images.item).toBe('img.self-ao-promote-page');

    const promoteResponse = await request.post(`/api/selector-discovery/${discoveryId}/promote`);
    const promoted = await promoteResponse.json();
    expect(promoteResponse.status(), promoted.error).toBe(200);
    expect(promoted.data.adapterId).toBe('self-ao-promote-e2e');
    expect(promoted.data.capabilities).toMatchObject({ verification: true, metadata: false, chapterImages: true });

    await page.goto('/');
    await page.getByTestId('task-mode-chapters').click();
    await page.getByTestId('chapter-url-input-0').fill(chapterUrl);
    await page.getByTestId('create-task-submit').click();

    const taskLink = page.locator('a[href^="/tasks/task-"]').first();
    await expect(taskLink).toBeVisible();
    const href = await taskLink.getAttribute('href');
    const taskId = href?.split('/').pop();
    expect(taskId).toBeTruthy();

    const completed = await waitForTask(request, taskId!, 'completed');
    expect(completed.task.status).toBe('completed');
    expect(completed.result.totalImages).toBe(1);
    expect(completed.result.downloadedImages).toBe(1);

    await taskLink.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
  });
});

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
