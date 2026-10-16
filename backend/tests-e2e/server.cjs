const path = require('node:path');
const fs = require('node:fs/promises');
const { ComicCrawlerServer } = require('../dist/server/app');
const { ConfigManager } = require('../dist/config/manager');
const { CrawlerEngine } = require('../dist/crawler/engine');
const { EventBus } = require('../dist/events/bus');
const { AdapterRegistry } = require('../dist/adapter/registry');
const { JsonFileStore } = require('../dist/storage/json-store');
const { TaskManager } = require('../dist/task/manager');
const { SelectorDiscoveryService, SelectorDiscoverySettingsStore } = require('../dist/selector-discovery');
const { ChallengeDiscoveryService } = require('../dist/challenge');
const { DynamicSiteAdapter } = require('../dist/adapter/dynamic-site-adapter');
const { ComicError, ErrorType, errorToLogObject } = require('../dist/error/types');
const { BrowserProviderRegistry } = require('../dist/browser/provider-registry');
const { BrowserLeaseCoordinator } = require('../dist/browser/lease-coordinator');
const { ReverseRelayBrowserProviderClient } = require('../../browser-provider-sdk/dist/src');
const { ApiSecurityService } = require('../dist/security/api-security');

process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS = 'true';

async function start() {
  const eventBus = new EventBus();
  await fs.rm(path.resolve(__dirname, '../../test-results/e2e-data'), { recursive: true, force: true });
  await fs.rm(path.resolve(__dirname, '../../test-results/e2e-downloads'), { recursive: true, force: true });
  const storage = new JsonFileStore({
    basePath: path.resolve(__dirname, '../../test-results/e2e-data'),
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
      challengeWaitMs: 1000,
    },
  });
  const browserProviderRegistry = new BrowserProviderRegistry(storage);
  await browserProviderRegistry.initialize();
  const browserLeaseCoordinator = new BrowserLeaseCoordinator(browserProviderRegistry, 10_000);
  const apiSecurity = ApiSecurityService.fromSecretDocument({ mode: 'public', defaultEffect: 'deny', rules: [] });
  const getBrowserConfig = async (sessionId) => browserProviderRegistry.resolveBrowserConfig(
    (await configManager.get()).browser,
    sessionId
  );

  const adapterRegistry = new AdapterRegistry(eventBus);
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
    downloadDir: path.resolve(__dirname, '../../test-results/e2e-downloads'),
    concurrency: 1,
    eventBus,
    browser: {
      mode: 'remote',
      maxInstances: 1,
      timeout: 30000,
      waitUntil: 'domcontentloaded',
      waitForSelector: '#reader img',
      postLoadDelayMs: 0,
      remote: {
        connectTimeout: 30000,
      },
    },
    resolveRemoteBrowser: async (sessionId) => (await getBrowserConfig(sessionId)).remote,
  });

  const taskManager = new TaskManager(async (task) => {
    const adapter = adapterRegistry.get(task.data.adapterId);
    if (!adapter) {
      throw new Error(`Adapter ${task.data.adapterId} not found`);
    }
    const lease = await browserLeaseCoordinator.acquire({
      taskId: task.id,
      ownerUserId: task.data.ownerUserId || 'public',
      target: task.data.browserTarget,
      baseBrowserConfig: (await configManager.get()).browser,
      timeoutMs: 10_000,
      onWaiting: (message) => taskManager.markWaitingForBrowserWorker(task.id, message),
    });
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
    getBrowserConfig,
    acquireBrowserSession: async ({ job, browserTarget }) => {
      const lease = await browserLeaseCoordinator.acquire({
        taskId: `selector:${job.id}`,
        ownerUserId: job.ownerUserId || 'public',
        target: browserTarget,
        baseBrowserConfig: (await configManager.get()).browser,
        timeoutMs: 10_000,
      });
      return { sessionId: lease.sessionId, release: () => lease.release() };
    },
    getNetworkConfig: async () => (await configManager.get()).network,
  });
  const challengeDiscoveryService = new ChallengeDiscoveryService(storage, {
    workspaceRoot: path.resolve(__dirname, '../../test-results/e2e-agent-workspaces'),
    getBrowserConfig,
    getNetworkConfig: async () => (await configManager.get()).network,
    acquireBrowserSession: async ({ jobId, ownerUserId, browserTarget }) => {
      const lease = await browserLeaseCoordinator.acquire({
        taskId: `challenge:${jobId}`,
        ownerUserId,
        target: browserTarget,
        baseBrowserConfig: (await configManager.get()).browser,
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
    crawlerEngine,
    eventBus,
    selectorDiscoveryService,
    selectorDiscoverySettingsStore,
    challengeDiscoveryService,
    browserProviderRegistry,
    browserLeaseCoordinator,
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

  const providerClients = [];
  const providerConnections = [];
  for (let index = 1; index <= 3; index += 1) {
    const enrollment = await browserProviderRegistry.register(apiSecurity.publicPrincipal(), {
      clientInstanceId: `e2e-provider-${index}`,
    });
    const provider = createE2eBrowserProvider(
      enrollment.providerId,
      process.env.COMICCRAWLER_E2E_BROWSER_WS_ENDPOINT,
      `e2e-process-${index}`
    );
    const providerClient = new ReverseRelayBrowserProviderClient({
      serverUrl: `http://${process.env.COMICCRAWLER_E2E_HOST || '127.0.0.1'}:${process.env.COMICCRAWLER_E2E_PORT || '4173'}`,
      credential: enrollment.credential,
      provider,
    });
    providerClients.push(providerClient);
    providerConnections.push(providerClient.connectOnce());
  }
  await waitFor(() => browserProviderRegistry.list().filter((entry) => entry.descriptor).length === 3);

  const shutdown = async () => {
    await Promise.all(providerClients.map((client) => client.close()));
    await Promise.all(providerConnections);
    await server.stop();
    await storage.dispose();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

function createE2eBrowserProvider(providerId, localWsEndpoint, processInstanceId) {
  if (!localWsEndpoint) throw new Error('COMICCRAWLER_E2E_BROWSER_WS_ENDPOINT is required.');
  const capabilities = {
    browser: 'chromium', headed: false, interactive: true, persistentContext: false,
    screenshots: true, downloads: true, tracing: true,
  };
  const runtimeVersion = require('playwright/package.json').version;
  const sessions = new Map();
  let sequence = 0;
  return {
    describe: async () => ({
      contractVersion: '2', providerId, processInstanceId, providerType: 'playwright',
      runtimeVersion, capabilities, transports: ['reverse-relay'],
    }),
    createSession: async () => {
      const now = Date.now();
      const session = {
        sessionId: `e2e-browser-session-${++sequence}`, providerId, protocol: 'playwright', transport: 'reverse-relay',
        localWsEndpoint, runtimeVersion, capabilities, createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 3_600_000).toISOString(),
      };
      sessions.set(session.sessionId, session);
      return session;
    },
    getSession: async (sessionId) => sessions.get(sessionId),
    heartbeat: async (sessionId) => sessions.get(sessionId),
    closeSession: async (sessionId) => { sessions.delete(sessionId); },
    close: async () => { sessions.clear(); },
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for E2E browser provider connection.');
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
    if (text.includes('# Capability Stage Task')) {
      const stage = /Produce only the ([a-z-]+) capability draft\./.exec(text)?.[1] || 'chapter-images';
      const sourcePath = /Write TypeScript capability source to ([^\s]+)\./.exec(text)?.[1];
      const reviewPath = /Write human review notes for this capability to ([^\s]+)\./.exec(text)?.[1];
      const source = fakeCapabilitySource(stage, `${conversation.files.get('task.md') || ''}\n${text}`);
      if (sourcePath) conversation.files.set(sourcePath, source);
      if (reviewPath) conversation.files.set(reviewPath, `# ${stage} review\n\nE2E fixture capability generated for review.`);
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
