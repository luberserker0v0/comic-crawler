const path = require('node:path');
const fs = require('node:fs/promises');
const { ComicCrawlerServer } = require('../dist/server/app');
const { ConfigManager } = require('../dist/config/manager');
const { CrawlerEngine } = require('../dist/crawler/engine');
const { EventBus } = require('../dist/events/bus');
const { AdapterRegistry } = require('../dist/adapter/registry');
const { AdapterCatalog } = require('../dist/adapter/catalog');
const { JsonFileStore } = require('../dist/storage/json-store');
const { TaskManager } = require('../dist/task/manager');
const { SelectorDiscoveryService, SelectorDiscoverySettingsStore } = require('../dist/selector-discovery');
const { ChallengeDiscoveryService } = require('../dist/challenge');
const { DynamicSiteAdapter } = require('../dist/adapter/dynamic-site-adapter');
const { ComicError, ErrorType, errorToLogObject } = require('../dist/error/types');
const { BrowserClientRegistry } = require('../dist/browser/browser-client-registry');
const { BrowserSessionGateway } = require('../dist/browser/browser-session-gateway');
const { BrowserWorkerLeaseCoordinator } = require('../dist/browser/browser-worker-lease-coordinator');
const { BrowserRenderService } = require('../dist/browser/browser-render-service');
const { BrowserClient, beginScrollableContentPreparation } = require('../../browser-client-sdk/dist/src');
const { chromium } = require('playwright');
const WebSocket = require('ws');
const { ApiSecurityService } = require('../dist/security/api-security');
const { TaskDeferredError } = require('../dist/scheduler');

process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS = 'true';

const e2eRoot = path.resolve(__dirname, '../../.artifacts/playwright/runtime');
const e2eDataPath = path.join(e2eRoot, 'data');
const e2eDownloadsPath = path.join(e2eRoot, 'downloads');
const e2eAgentWorkspacesPath = path.join(e2eRoot, 'agent-workspaces');

async function start() {
  const eventBus = new EventBus();
  await fs.rm(e2eDataPath, { recursive: true, force: true });
  await fs.rm(e2eDownloadsPath, { recursive: true, force: true });
  const storage = new JsonFileStore({
    basePath: e2eDataPath,
    flushInterval: 0,
  });
  await storage.initialize();

  const configManager = new ConfigManager(storage, eventBus);
  await configManager.load();
  const loadedConfig = await configManager.get();
  await configManager.update({
    browser: {
      ...loadedConfig.browser,
      timeout: 10000,
      workerWaitTimeoutMs: 10_000,
    },
  });
  const apiSecurity = ApiSecurityService.fromSecretDocument({ mode: 'public', defaultEffect: 'deny', rules: [] });
  const browserClientRegistry = new BrowserClientRegistry(storage);
  await browserClientRegistry.initialize();
  const browserSessionGateway = new BrowserSessionGateway(browserClientRegistry, apiSecurity);
  const browserLeaseCoordinator = new BrowserWorkerLeaseCoordinator(browserSessionGateway, 10_000);
  const browserRenderService = new BrowserRenderService(browserSessionGateway);
  const getBrowserConfig = async () => (await configManager.get()).browser;

  const adapterRegistry = new AdapterRegistry(eventBus);
  const adapterCatalog = new AdapterCatalog(storage);
  await adapterCatalog.initialize();
  adapterRegistry.register({
    id: 'kuronavi',
    name: 'Kuronavi E2E Fixture',
    domains: ['kuronavi.one'],
    parseMode: 'playwright',
    matchUrl: (url) => url.includes('kuronavi.one'),
    capabilities: { verification: false, metadata: true, chapterImages: true },
    loadDocument: async () => ({}),
    extractTitle: async () => 'Fixture',
    extractAuthor: async () => undefined,
    extractDescription: async () => undefined,
    extractCoverUrl: async () => undefined,
    extractTags: async () => [],
    extractStatus: async () => 'unknown',
    extractChapterList: async () => [],
    extractChapterImageUrls: async () => [],
  });

  const reliabilityState = {
    verifiedHosts: new Set(),
  };

  adapterRegistry.register({
    id: 'reliability-fixture',
    name: 'Reliability Fixture',
    domains: ['reliability-fixture.invalid'],
    parseMode: 'playwright',
    capabilities: { verification: true, metadata: true, chapterImages: true },
    matchUrl: (url) => /\/api\/fixtures\/reliability-/.test(url),
    loadDocument: async (url) => url,
    extractTitle: async () => 'Reliability Fixture',
    extractAuthor: async () => undefined,
    extractDescription: async () => undefined,
    extractCoverUrl: async () => undefined,
    extractTags: async () => [],
    extractStatus: async () => 'unknown',
    extractChapterList: async (_document, url) => [
        { id: 'chapter-1', title: 'Chapter 1', url: `${new URL(url).origin}/api/fixtures/reliability-ok-chapter-1` },
        { id: 'chapter-2', title: 'Chapter 2', url: `${new URL(url).origin}/api/fixtures/reliability-ok-chapter-2` },
    ],
    extractChapterImageUrls: async (_document, chapterUrl) => {
      const parsed = new URL(chapterUrl);
      if (chapterUrl.includes('reliability-challenge') && !reliabilityState.verifiedHosts.has(parsed.hostname)) {
        throw new ComicError(
          'Human verification is required for reliability fixture.',
          ErrorType.AUTH_ERROR,
          false,
          {
            antiBotChallenge: true,
            challengeType: 'cloudflare_js_challenge',
            url: chapterUrl,
          }
        );
      }
      const chapterId = parsed.pathname.split('/').filter(Boolean).at(-1) || 'chapter';
      return [
        `${parsed.origin}/api/fixtures/reliability-image/${chapterId}-1.jpg`,
        `${parsed.origin}/api/fixtures/reliability-image/${chapterId}-2.jpg`,
      ];
    },
  });

  const crawlerEngine = new CrawlerEngine({
    downloadDir: e2eDownloadsPath,
    concurrency: 1,
    eventBus,
    browser: {
      timeout: 30000,
      workerWaitTimeoutMs: 10_000,
      postLoadDelayMs: 0,
    },
    browserRenderService,
  });

  const taskManager = new TaskManager(async (task) => {
    const adapter = adapterRegistry.get(task.data.adapterId);
    if (!adapter) {
      throw new Error(`Adapter ${task.data.adapterId} not found`);
    }
    const lease = await browserLeaseCoordinator.tryAcquire({
      taskId: task.id,
      ownerUserId: task.data.ownerUserId || 'public',
      target: task.data.browserTarget,
      initialUrl: task.data.browserTargetUrl || task.data.url,
    });
    if (!lease) {
      const message = task.data.browserTarget?.mode === 'existing-tab' || task.data.browserTarget?.workerId
        ? `Waiting for browser worker "${task.data.browserTarget.workerId}".`
        : 'Waiting for an available managed-profile browser worker.';
      await taskManager.markWaitingForBrowserWorker(task.id, message);
      throw new TaskDeferredError(message, 250);
    }
    let leaseTransferred = false;
    try {
      await crawlerEngine.crawl(adapter, task.data.url, {
        chapters: task.data.chapters,
        chapterUrls: task.data.chapterUrls,
        taskId: task.id,
        browserSessionId: lease.sessionId,
        checkpoint: taskManager.getCheckpoint(task.id),
        onCheckpoint: (checkpoint) => taskManager.updateCheckpoint(task.id, checkpoint),
      });
    } catch (error) {
      if (isHumanVerificationRequiredError(error)) {
        const verificationUrl = task.data.chapterUrls?.[0] ?? task.data.url;
        const challengeJob = await challengeDiscoveryService.create({
          url: verificationUrl,
          browserLease: lease,
          ownerUserId: task.data.ownerUserId,
          browserTarget: task.data.browserTarget,
        });
        leaseTransferred = true;
        throw new ComicError(
          `Human verification is required before crawling can continue. Challenge discovery job: ${challengeJob.id}`,
          ErrorType.AUTH_ERROR,
          false,
          {
            adapterId: adapter.id,
            url: verificationUrl,
            challengeDiscoveryId: challengeJob.id,
            challengeStatus: challengeJob.status,
            originalError: errorToLogObject(error),
          }
        );
      }
      throw error;
    } finally {
      if (!leaseTransferred) await lease.release();
    }
  }, { eventBus, storage });
  await taskManager.initialize();
  const selectorDiscoverySettingsStore = new SelectorDiscoverySettingsStore(storage);
  const selectorDiscoveryService = new SelectorDiscoveryService(storage, adapterRegistry, {
    adapterCatalog,
    getBrowserConfig,
    renderBrowserPage: (sessionId, url, options) => browserRenderService.render(sessionId, url, options),
    acquireBrowserSession: async ({ job, browserTarget }) => {
      const lease = await browserLeaseCoordinator.acquire({
        taskId: `selector:${job.id}`,
        ownerUserId: job.ownerUserId || 'public',
        target: browserTarget,
        initialUrl: job.normalizedUrl,
        timeoutMs: 10_000,
      });
      return { sessionId: lease.sessionId, release: () => lease.release() };
    },
    getNetworkConfig: async () => (await configManager.get()).network,
  });
  const challengeDiscoveryService = new ChallengeDiscoveryService(storage, {
    workspaceRoot: e2eAgentWorkspacesPath,
    getBrowserConfig,
    browserRenderService,
    getNetworkConfig: async () => (await configManager.get()).network,
    acquireBrowserSession: async ({ jobId, ownerUserId, url, browserTarget }) => {
      const lease = await browserLeaseCoordinator.acquire({
        taskId: `challenge:${jobId}`,
        ownerUserId,
        target: browserTarget,
        initialUrl: url,
        timeoutMs: 10_000,
      });
      return { sessionId: lease.sessionId, release: () => lease.release() };
    },
  });

  const server = new ComicCrawlerServer({
    port: Number.parseInt(process.env.COMICCRAWLER_E2E_PORT || '4173', 10),
    host: process.env.COMICCRAWLER_E2E_HOST || '127.0.0.1',
    configManager,
    taskManager,
    adapterRegistry,
    adapterCatalog,
    crawlerEngine,
    eventBus,
    selectorDiscoveryService,
    selectorDiscoverySettingsStore,
    challengeDiscoveryService,
    browserClientRegistry,
    browserSessionGateway,
    browserLeaseCoordinator,
    browserRenderService,
    staticDir: path.resolve(__dirname, '../../frontend/dist'),
    apiSecurity,
  });

  installFakeAo(server.getApp());

  server.getApp().get('/api/fixtures/discovery-chapter', async (_request, reply) => {
    reply.type('text/html').send(`<!doctype html>
      <html>
        <head><title>Discovery E2E Chapter</title></head>
        <body>
          <main id="reader"></main>
          <script>
            setTimeout(() => {
              const img = document.createElement('img');
              img.className = 'page-image';
              img.setAttribute('data-src', '/api/fixtures/discovery-image.jpg');
              document.querySelector('#reader').appendChild(img);
            }, 50);
          </script>
        </body>
      </html>`);
  });

  server.getApp().get('/api/fixtures/fixture-replay-generated-chapter', async (_request, reply) => {
    reply.type('text/html').send(`<!doctype html>
      <html>
        <head><title>Fixture Replay Generated Chapter</title></head>
        <body>
          <main id="reader">
            <img class="fixture-replay-page" data-src="/api/fixtures/discovery-image.jpg" />
          </main>
        </body>
      </html>`);
  });

  server.getApp().get('/api/fixtures/fixture-replay-draft-chapter', async (_request, reply) => {
    reply.type('text/html').send(`<!doctype html>
      <html>
        <head><title>Fixture Replay Draft Chapter</title></head>
        <body>
          <main id="reader">
            <img class="fixture-replay-draft-page" data-src="/api/fixtures/discovery-image.jpg" />
          </main>
        </body>
      </html>`);
  });

  server.getApp().get('/api/fixtures/responsive-chapter', async (_request, reply) => {
    reply.type('text/html').send(`<!doctype html>
      <html>
        <head><title>Responsive Chapter</title></head>
        <body>
          <main id="reader"></main>
          <script>
            const layout = window.innerWidth <= 600 ? 'mobile' : 'desktop';
            const reader = document.querySelector('#reader');
            for (let page = 1; page <= 2; page += 1) {
              const image = document.createElement('img');
              image.className = 'responsive-page';
              image.setAttribute('data-src', '/api/fixtures/responsive-' + layout + '-' + page + '.jpg');
              reader.appendChild(image);
            }
          </script>
        </body>
      </html>`);
  });

  server.getApp().get('/api/fixtures/discovery-image.jpg', async (_request, reply) => {
    reply.header('content-type', 'image/jpeg').send(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  server.getApp().get('/api/fixtures/reliability-ok-chapter-:id', async (request, reply) => {
    reply.type('text/html').send(`<!doctype html>
      <html>
        <head><title>Reliability OK ${request.params.id}</title></head>
        <body>
          <main id="reader">
            <img class="reliability-page" src="/api/fixtures/reliability-image/ok-${request.params.id}-1.jpg" />
            <img class="reliability-page" src="/api/fixtures/reliability-image/ok-${request.params.id}-2.jpg" />
          </main>
        </body>
      </html>`);
  });

  server.getApp().get('/api/fixtures/reliability-challenge-chapter-:id', async (request, reply) => {
    reply.type('text/html').send(`<!doctype html>
      <html>
        <head><title>Reliability Challenge ${request.params.id}</title></head>
        <body>
          <main id="reader">
            <img class="reliability-page" src="/api/fixtures/reliability-image/challenge-${request.params.id}-1.jpg" />
            <img class="reliability-page" src="/api/fixtures/reliability-image/challenge-${request.params.id}-2.jpg" />
          </main>
        </body>
      </html>`);
  });

  server.getApp().get('/api/fixtures/reliability-image/:name', async (_request, reply) => {
    reply.header('content-type', 'image/jpeg').send(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  server.getApp().post('/__test/reliability/verify', async (request, reply) => {
    const url = request.body?.url || 'http://127.0.0.1:4173/';
    const host = new URL(url).hostname;
    reliabilityState.verifiedHosts.add(host);
    const jobs = await challengeDiscoveryService.list();
    for (const job of jobs.filter((candidate) => candidate.hostname === host)) {
      const existing = await storage.read(`challenge-discovery-job-${job.id}`);
      if (existing) {
        await storage.write(`challenge-discovery-job-${job.id}`, {
          ...existing,
          status: 'ready',
          error: undefined,
          diagnosisMarkdown: '# Challenge Diagnosis\n\n## Status\n\n- Status: ready\n- Source: E2E reliability fixture\n',
          updatedAt: new Date().toISOString(),
        });
      }
    }
    reply.send({ host, verified: true });
  });

  server.getApp().post('/__test/register-fixture-replay-generated-adapter', async (request, reply) => {
    const manifest = request.body;
    if (adapterRegistry.has(manifest.adapterId)) {
      adapterRegistry.unregister(manifest.adapterId);
    }
    adapterRegistry.register(new DynamicSiteAdapter(manifest));
    reply.send({ adapterId: manifest.adapterId });
  });

  server.getApp().get('/api/fixtures/challenge-never-clears', async (_request, reply) => {
    reply.type('text/html').send(`<!doctype html>
      <html>
        <head><title>Attention Required! | Cloudflare</title></head>
        <body>
          <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
          Cloudflare Ray ID
        </body>
      </html>`);
  });

  server.getApp().get('/api/fixtures/challenge-clears', async (_request, reply) => {
    reply.type('text/html').send(`<!doctype html>
      <html>
        <head><title>Attention Required! | Cloudflare</title></head>
        <body>
          <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
          <main id="reader"></main>
          <script>
            setTimeout(() => {
              document.title = 'Challenge Cleared Reader';
              const script = document.querySelector('script[src*="cdn-cgi"]');
              if (script) script.remove();
              const img = document.createElement('img');
              img.className = 'page-image';
              img.setAttribute('data-src', '/api/fixtures/discovery-image.jpg');
              document.querySelector('#reader').appendChild(img);
            }, 500);
          </script>
        </body>
      </html>`);
  });

  await server.start();

  const browserClients = [];
  for (let index = 1; index <= 3; index += 1) {
    const stateStore = createMemoryStateStore();
    const browserClient = new BrowserClient({
      serverUrl: `http://${process.env.COMICCRAWLER_E2E_HOST || '127.0.0.1'}:${process.env.COMICCRAWLER_E2E_PORT || '4173'}`,
      executor: createE2eBrowserExecutor(process.env.COMICCRAWLER_E2E_BROWSER_WS_ENDPOINT),
      stateStore,
      webSocketFactory: { create: (url) => new WebSocket(url) },
    });
    await browserClient.enroll({ name: `E2E Browser Client ${index}` });
    await browserClient.connect();
    browserClients.push(browserClient);
  }
  await waitFor(() => browserSessionGateway.listWorkers().filter((worker) => worker.online).length === 3);

  const shutdown = async () => {
    await Promise.all(browserClients.map((client) => client.close()));
    await server.stop();
    await storage.dispose();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

function createE2eBrowserExecutor(localWsEndpoint) {
  if (!localWsEndpoint) throw new Error('COMICCRAWLER_E2E_BROWSER_WS_ENDPOINT is required.');
  const capabilities = {
    executionMode: 'managed-profile',
    navigation: true,
    renderedDom: true,
    humanHandoff: true,
    responsiveViewport: true,
  };
  return {
    describe: async () => capabilities,
    openSession: (request) => openE2eBrowserSession(localWsEndpoint, request),
    close: async () => undefined,
  };
}

async function openE2eBrowserSession(localWsEndpoint, request) {
  const browser = await chromium.connect(localWsEndpoint);
  const context = await browser.newContext({
    viewport: request.renderContext?.viewport,
    deviceScaleFactor: request.renderContext?.deviceScaleFactor,
    isMobile: request.renderContext?.isMobile,
    hasTouch: request.renderContext?.hasTouch,
    userAgent: request.renderContext?.userAgent,
  });
  const page = await context.newPage();
  const state = { browser, context, page, preparation: undefined, operationId: undefined };
  return { execute: (command, signal) => executeE2eBrowserCommand(state, command, signal),
    close: () => closeE2eBrowserSession(state) };
}

async function executeE2eBrowserCommand(state, command, signal) {
  if (command.type === 'page.navigate') return navigateE2ePage(state.page, command);
  if (command.type === 'page.get-url') return { type: command.type, url: state.page.url() };
  if (command.type === 'page.get-content')
    return { type: command.type, url: state.page.url(), html: await state.page.content() };
  if (command.type === 'page.wait-for-ready') return waitForE2ePage(state.page, command);
  if (command.type === 'page.prepare.start') return startE2ePreparation(state, command);
  if (command.type === 'page.prepare.step') return stepE2ePreparation(state, command, signal);
  if (command.type === 'page.prepare.finish') return finishE2ePreparation(state, command);
  await state.page.bringToFront();
  return { type: 'page.focus' };
}

async function navigateE2ePage(page, command) {
  await page.goto(command.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return { type: command.type, url: page.url() };
}

async function waitForE2ePage(page, command) {
  await page.waitForLoadState('domcontentloaded', { timeout: command.timeoutMs || 30_000 })
    .catch(() => undefined);
  await page.waitForTimeout(750);
  return { type: command.type, url: page.url() };
}

async function startE2ePreparation(state, command) {
  if (state.preparation) throw new Error('Reader preparation is already active.');
  const execute = (script, argument) => state.page.evaluate(script, argument);
  state.preparation = await beginScrollableContentPreparation(execute, command.reader);
  state.operationId = command.operationId;
  return { type: command.type, operationId: command.operationId, progress: state.preparation.progress };
}

async function stepE2ePreparation(state, command, signal) {
  assertE2ePreparation(state, command.operationId);
  const progress = await state.preparation.step(command.budget, signal);
  return { type: command.type, operationId: command.operationId, progress };
}

async function finishE2ePreparation(state, command) {
  assertE2ePreparation(state, command.operationId);
  await state.preparation.finish();
  state.preparation = undefined;
  state.operationId = undefined;
  return { type: command.type, operationId: command.operationId, url: state.page.url() };
}

function assertE2ePreparation(state, operationId) {
  if (!state.preparation || state.operationId !== operationId)
    throw new Error('Reader preparation operation does not exist.');
}

async function closeE2eBrowserSession(state) {
  await state.preparation?.finish().catch(() => undefined);
  state.preparation = undefined;
  await state.context.close().catch(() => undefined);
  await state.browser.close().catch(() => undefined);
}

function createMemoryStateStore() {
  let state;
  return {
    get: async () => state,
    set: async (value) => { state = value; },
    clear: async () => { state = undefined; },
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for E2E Browser Client connection.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function installFakeAo(app) {
  const conversations = new Map();

  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.post('/__ao/api/conversations', async (_request, reply) => {
    const id = `ao-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    conversations.set(id, { id, ready: false, status: 'prepared', sessionId: undefined, files: new Map(), messages: [] });
    reply.send({ id });
  });

  app.post('/__ao/api/conversations/:id/config', async (request, reply) => {
    getConversation(conversations, request.params.id).config = request.body;
    reply.send({});
  });

  app.put('/__ao/api/conversations/:id/agent/config', async (request, reply) => {
    getConversation(conversations, request.params.id).agentConfig = request.body?.content;
    reply.send({});
  });

  app.put('/__ao/api/conversations/:id/agents', async (request, reply) => {
    const conversation = getConversation(conversations, request.params.id);
    conversation.agents = conversation.agents || {};
    conversation.agents[request.body?.name] = request.body?.content;
    reply.send({});
  });

  app.post('/__ao/api/conversations/:id/skills/upload', async (request, reply) => {
    const conversation = getConversation(conversations, request.params.id);
    conversation.skills = conversation.skills || [];
    conversation.skills.push(request.query?.name || 'skill');
    reply.send({});
  });

  app.put('/__ao/api/conversations/:id/files', async (request, reply) => {
    const conversation = getConversation(conversations, request.params.id);
    conversation.files.set(request.body?.path, request.body?.content ?? '');
    reply.send({});
  });

  app.post('/__ao/api/conversations/:id/files/read', async (request, reply) => {
    const conversation = getConversation(conversations, request.params.id);
    reply.send({ content: conversation.files.get(request.body?.path) ?? '' });
  });

  app.post('/__ao/api/conversations/:id/start', async (request, reply) => {
    const conversation = getConversation(conversations, request.params.id);
    conversation.ready = true;
    conversation.status = 'ready';
    conversation.sessionId = `session-${request.params.id}`;
    reply.send({});
  });

  app.post('/__ao/api/conversations/:id/sessions', async (request, reply) => {
    const conversation = getConversation(conversations, request.params.id);
    conversation.sessionId = conversation.sessionId || `session-${request.params.id}`;
    reply.send({ id: conversation.sessionId });
  });

  app.get('/__ao/api/conversations/:id', async (request, reply) => {
    const conversation = getConversation(conversations, request.params.id);
    reply.send({
      id: conversation.id,
      status: conversation.status,
      ready: conversation.ready,
      sessionId: conversation.sessionId,
    });
  });

  app.post('/__ao/api/conversations/:id/message', async (request, reply) => {
    const conversation = getConversation(conversations, request.params.id);
    const text = request.body?.text || '';
    const stage = /^# (common-verification|metadata|reader-preparation|chapter-images)$/m.exec(text);
    if (stage) {
      const stageName = stage[1];
      const sourcePath = /(?:Write TypeScript capability source to|- TypeScript:)\s+([^\s]+)\.?/.exec(text)?.[1]?.replace(/\.$/, '');
      const reviewPath = /(?:Write human review notes for this capability to|- Markdown review:)\s+([^\s]+)\.?/.exec(text)?.[1]?.replace(/\.$/, '');
      const source = fakeCapabilitySource(stageName, `${conversation.files.get('task.md') || ''}\n${text}`);
      if (sourcePath) conversation.files.set(sourcePath, source);
      if (reviewPath) conversation.files.set(reviewPath, `# ${stageName} review\n\nE2E fixture capability generated for review.`);
      conversation.messages.push({ text, model: request.body?.model, agent: request.body?.agent });
      reply.send({ messageId: `msg-${conversation.messages.length}`, text: `Wrote ${sourcePath} and ${reviewPath}.` });
      return;
    }
    const output = fakePhase1Markdown(text);
    conversation.files.set('outputs/phase1-output.md', output);
    conversation.messages.push({ text, model: request.body?.model, agent: request.body?.agent });
    reply.send({ messageId: `msg-${conversation.messages.length}`, text: output });
  });

  app.delete('/__ao/api/conversations/:id', async (request, reply) => {
    conversations.delete(request.params.id);
    reply.send({});
  });
}

function getConversation(conversations, id) {
  const conversation = conversations.get(id);
  if (!conversation) {
    throw new Error(`Fake AO conversation ${id} was not found`);
  }
  return conversation;
}

function fakePhase1Markdown(text = '') {
  const sourceUrl = extractSourceUrl(text) || 'http://127.0.0.1:4173/api/fixtures/discovery-chapter';
  return `## 網站判斷

- Type: chapter page
- Representative Chapter URL: ${sourceUrl}

## Metadata Selectors

- Title:

## Chapter List Selectors

- Item:

## Representative Chapter URL

${sourceUrl}

## Evidence

- E2E fake AO selected the submitted chapter URL.

## Uncertainty

- none`;
}

function fakeCapabilitySource(stage, text = '') {
  if (stage === 'common-verification') {
    const skeletons = [...text.matchAll(/```ts\s*([\s\S]*?)```/g)];
    const skeleton = skeletons.at(-1)?.[1]?.trim() || '';
    const sourceUrl = extractSourceUrl(text) || '';
    const fixturePrefix = sourceUrl.includes('/api/fixtures/discovery-')
      ? '/api/fixtures/discovery-'
      : sourceUrl.includes('/api/fixtures/challenge-clears')
        ? '/api/fixtures/challenge-clears'
        : undefined;
    return fixturePrefix
      ? skeleton.replace(/parsed\.pathname === '\/api' \|\| parsed\.pathname\.startsWith\('\/api\/'\)/, `parsed.pathname.startsWith('${fixturePrefix}')`)
      : skeleton;
  }
  const sourceUrl = extractSourceUrl(text) || 'http://127.0.0.1:4173/api/fixtures/discovery-chapter';
  const imageSelector = sourceUrl.includes('fixture-replay-draft')
    ? 'img.fixture-replay-draft-page'
    : 'img.page-image';
  if (stage === 'reader-preparation') return `import { ReaderPreparationCapability } from '../../base';

class E2EReaderPreparationCapability extends ReaderPreparationCapability {
  getReaderContainerSelector(sourceUrl: string): string { void sourceUrl; return '#reader, main.reader, main'; }
  getReaderPageSelector(sourceUrl: string): string { void sourceUrl; return '${imageSelector}'; }
}`;
  if (stage === 'metadata') return `import type { ChapterInfo } from '@comiccrawler/shared';
import { MetadataCapability } from '../../base';
class E2EMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string {
    const $ = this.adapter.asCheerio(document); void sourceUrl; return $('h1').first().text().trim();
  }
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const $ = this.adapter.asCheerio(document); return $('a[href]').map((_, node) => {
      const url = this.adapter.resolveUrl(sourceUrl, $(node).attr('href') || '');
      return { id: new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'chapter', title: $(node).text().trim(), url };
    }).get();
  }
}`;
  return `import { ChapterImagesCapability } from '../../base';

class E2EChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    return $('${imageSelector}').map((_, element) => {
      const raw = $(element).attr('data-src') ?? $(element).attr('src') ?? '';
      return raw ? this.adapter.resolveUrl(sourceUrl, raw) : '';
    }).get().filter(Boolean);
  }
}`;
}

function extractSourceUrl(text) {
  return /## Source URL\s+([\s\S]*?)(?:\n## |\n# |$)/.exec(text)?.[1]?.trim().split(/\s+/)[0];
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

function isHumanVerificationRequiredError(error) {
  if (error instanceof ComicError) {
    return hasHumanVerificationContext(error.context);
  }
  const message = error instanceof Error ? error.message : String(error);
  return /anti-bot|human verification|challenge|cloudflare|sorry, you have been blocked|unable to access/i.test(message);
}

function hasHumanVerificationContext(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.antiBotChallenge === true || value.challengeType === 'access_blocked') return true;
  return Object.values(value).some((entry) => hasHumanVerificationContext(entry));
}
