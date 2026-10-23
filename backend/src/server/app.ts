import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserTarget, EffectiveRenderContext } from '@comiccrawler/shared';
import type { ConfigManager } from '../config/manager';
import type { TaskManager } from '../task/manager';
import type { AdapterRegistry } from '../adapter/registry';
import type { AdapterCatalog } from '../adapter/catalog';
import type { OfficialAdapterRegistryService } from '../adapter/official-registry';
import type { CrawlerEngine } from '../crawler/engine';
import type { EventBus } from '../events/bus';
import type { AgentAdminService } from '../agent/admin-service';
import type { SelectorDiscoveryService, SelectorDiscoverySettingsStore } from '../selector-discovery';
import type { ChallengeDiscoveryService } from '../challenge';
import type { AdapterDraftService } from '../adapter-drafts/service';
import type { FixtureCaptureService } from '../fixtures/fixture-capture-service';
import type { MaintenanceService } from '../maintenance/service';
import type { IStorage } from '../storage/types';
import type { BrowserClientRegistry } from '../browser/browser-client-registry';
import type { BrowserSessionGateway } from '../browser/browser-session-gateway';
import type { BrowserWorkerLease, BrowserWorkerLeaseCoordinator } from '../browser/browser-worker-lease-coordinator';
import type { BrowserRenderService } from '../browser/browser-render-service';
import { ApiSecurityService } from '../security/api-security';
import { COMICCRAWLER_VERSION } from '../version';
import { setupTasksRoutes } from './routes/tasks';
import { setupConfigRoutes } from './routes/config';
import { setupAdaptersRoutes } from './routes/adapters';
import { setupSearchRoutes } from './routes/search';
import { setupAgentRoutes } from './routes/agent';
import { setupSelectorDiscoveryRoutes } from './routes/selector-discovery';
import { setupChallengeDiscoveryRoutes } from './routes/challenge-discovery';
import { setupFixtureRoutes } from './routes/fixtures';
import { setupAdapterDraftRoutes } from './routes/adapter-drafts';
import { setupMaintenanceRoutes } from './routes/maintenance';
import { setupBrowserClientRoutes } from './routes/browser-clients';
import { setupAdapterRegistryRoutes } from './routes/adapter-registry';
import { setupWebSocket } from './websocket';
import { setupCors } from './middleware/cors';
import { setupApiSecurity } from './middleware/api-security';
import { requestPrincipal } from './middleware/api-security';
import { logger } from '../utils/logger';
import type { BrowserLeaseClaim } from './routes/adapter-function-runner';

export interface ServerOptions {
  port: number;
  host: string;
  configManager: ConfigManager;
  taskManager: TaskManager;
  adapterRegistry: AdapterRegistry;
  adapterCatalog?: AdapterCatalog;
  officialAdapterRegistry?: OfficialAdapterRegistryService;
  crawlerEngine: CrawlerEngine;
  eventBus: EventBus;
  agentAdminService?: AgentAdminService;
  selectorDiscoveryService?: SelectorDiscoveryService;
  selectorDiscoverySettingsStore?: SelectorDiscoverySettingsStore;
  challengeDiscoveryService?: ChallengeDiscoveryService;
  adapterDraftService?: AdapterDraftService;
  fixtureCaptureService?: FixtureCaptureService;
  maintenanceService?: MaintenanceService;
  browserClientRegistry?: BrowserClientRegistry;
  browserSessionGateway?: BrowserSessionGateway;
  browserLeaseCoordinator?: BrowserWorkerLeaseCoordinator;
  browserRenderService?: BrowserRenderService;
  storage?: IStorage;
  staticDir?: string;
  cors?: { origin: string[] };
  apiSecurity?: ApiSecurityService;
}

export class ComicCrawlerServer {
  private app: FastifyInstance;
  private options: ServerOptions;
  private httpServer?: import('node:http').Server;
  private readonly apiSecurity: ApiSecurityService;

  constructor(options: ServerOptions) {
    this.options = options;
    this.apiSecurity = options.apiSecurity ?? ApiSecurityService.fromSecretDocument({
      mode: 'public',
      defaultEffect: 'deny',
      rules: [],
    });
    this.app = this.createApp();
    setupApiSecurity(this.app, this.apiSecurity);
    this.setupRoutes();
    this.setupApiDocs();
    this.setupHealthCheck();
  }

  private createApp(): FastifyInstance {
    const fastify = require('fastify')({
      loggerInstance: logger,
    });

    return fastify;
  }

  async start(): Promise<void> {
    if (this.options.cors) {
      setupCors(this.app, this.options.cors);
    }

    if (this.options.staticDir) {
      this.setupStaticFiles();
      this.setupSpaFallback();
    }

    await this.app.listen({ port: this.options.port, host: this.options.host });
    this.httpServer = this.app.server;

    setupWebSocket(this.httpServer, this.options.eventBus, this.options.browserSessionGateway, this.apiSecurity);

    logger.info({ host: this.options.host, port: this.options.port }, 'Server started');
  }

  async stop(): Promise<void> {
    await this.app.close();
    await this.options.taskManager.dispose();
    await this.options.crawlerEngine.dispose();
    await this.options.challengeDiscoveryService?.dispose();
    await this.options.browserLeaseCoordinator?.dispose();
    this.options.browserSessionGateway?.dispose();
    this.options.browserClientRegistry?.dispose();
    this.options.selectorDiscoveryService?.dispose();

    await Promise.all(
      this.options.adapterRegistry.getAll().map(async (adapter) => {
        if ('dispose' in adapter && typeof adapter.dispose === 'function') {
          await adapter.dispose();
        }
      })
    );
  }

  getApp(): FastifyInstance {
    return this.app;
  }

  private setupRoutes(): void {
    this.setupCoreRoutes();
    this.setupAdapterRoutes();
    this.setupDiscoveryRoutes();
    this.setupOptionalRoutes();
  }

  private setupCoreRoutes(): void {
    setupTasksRoutes(
      this.app,
      this.options.taskManager,
      this.options.adapterRegistry,
      this.options.selectorDiscoveryService,
      this.options.challengeDiscoveryService,
      {
        downloadDir: async () => (await this.options.configManager.get()).download.directory,
        browserLeaseCoordinator: this.options.browserLeaseCoordinator,
        apiSecurity: this.apiSecurity,
      }
    );
    setupConfigRoutes(this.app, this.options.configManager);
    if (this.options.browserClientRegistry && this.options.browserSessionGateway) {
      setupBrowserClientRoutes(this.app, this.options.browserClientRegistry, this.options.browserSessionGateway, this.apiSecurity);
    }
    setupSearchRoutes(this.app, this.options.crawlerEngine);
    setupFixtureRoutes(this.app, this.options.adapterRegistry, this.options.fixtureCaptureService, this.options.adapterCatalog);
  }

  private setupAdapterRoutes(): void {
    setupAdaptersRoutes(this.app, this.options.adapterRegistry, {
      challengeDiscoveryService: this.options.challengeDiscoveryService,
      withBrowserSession: (request, target, initialUrl, renderContext, action) =>
        this.withBrowserSession(request, target, initialUrl, renderContext, action),
      browserRenderService: this.options.browserRenderService,
      getNetworkConfig: async () => (await this.options.configManager.get()).network,
      storage: this.options.storage,
      adapterCatalog: this.options.adapterCatalog,
      apiSecurity: this.apiSecurity,
    });
    if (this.options.officialAdapterRegistry)
      setupAdapterRegistryRoutes(this.app, this.options.officialAdapterRegistry);
    this.setupAdapterDraftRoutes();
  }

  private setupAdapterDraftRoutes(): void {
    if (!this.options.adapterDraftService) return;
    setupAdapterDraftRoutes(this.app, this.options.adapterDraftService, {
      challengeDiscoveryService: this.options.challengeDiscoveryService,
      withBrowserSession: (request, target, initialUrl, action) =>
        this.withBrowserSession(request, target, initialUrl, undefined, action),
      browserRenderService: this.options.browserRenderService,
      getNetworkConfig: async () => (await this.options.configManager.get()).network,
      apiSecurity: this.apiSecurity,
    });
  }

  private setupDiscoveryRoutes(): void {
    if (this.options.selectorDiscoveryService && this.options.selectorDiscoverySettingsStore) {
      setupSelectorDiscoveryRoutes(
        this.app,
        this.options.selectorDiscoveryService,
        this.options.selectorDiscoverySettingsStore,
        undefined,
        {
          challengeDiscoveryService: this.options.challengeDiscoveryService,
          adapterDraftService: this.options.adapterDraftService,
          withBrowserSession: (request, target, initialUrl, action) =>
            this.withBrowserSession(request, target, initialUrl, undefined, action),
          browserRenderService: this.options.browserRenderService,
          getNetworkConfig: async () => (await this.options.configManager.get()).network,
          browserLeaseCoordinator: this.options.browserLeaseCoordinator,
          apiSecurity: this.apiSecurity,
        }
      );
    }
  }

  private setupOptionalRoutes(): void {
    if (this.options.challengeDiscoveryService) {
      setupChallengeDiscoveryRoutes(
        this.app,
        this.options.challengeDiscoveryService,
        this.options.selectorDiscoveryService,
        { apiSecurity: this.apiSecurity }
      );
    }
    if (this.options.agentAdminService) {
      setupAgentRoutes(this.app, this.options.agentAdminService, this.options.adapterRegistry);
    }
    if (this.options.maintenanceService) {
      setupMaintenanceRoutes(this.app, this.options.maintenanceService);
    }
  }

  private async withBrowserSession<T>(
    request: FastifyRequest,
    target: BrowserTarget | undefined,
    initialUrl: string,
    renderContext: EffectiveRenderContext | undefined,
    action: (sessionId: string, claimBrowserLease: BrowserLeaseClaim) => Promise<T>
  ): Promise<T> {
    const browser = (await this.options.configManager.get()).browser;
    const coordinator = this.requireLeaseCoordinator();
    const principal = requestPrincipal(request, this.apiSecurity);
    const lease = await coordinator.acquire({ taskId: `operation:${randomUUID()}`,
      ownerUserId: principal.userId, target, initialUrl, renderContext,
      timeoutMs: browser.workerWaitTimeoutMs });
    const transfer = createBrowserLeaseTransfer(lease);
    try {
      return await action(lease.sessionId, transfer.claim);
    } finally {
      if (!transfer.claimed()) await lease.release();
    }
  }

  private requireLeaseCoordinator(): BrowserWorkerLeaseCoordinator {
    if (!this.options.browserLeaseCoordinator) throw new Error('Browser Worker service is not configured.');
    return this.options.browserLeaseCoordinator;
  }

  private setupStaticFiles(): void {
    this.app.register(require('@fastify/static'), {
      root: this.options.staticDir!,
      prefix: '/',
    });
  }

  private setupSpaFallback(): void {
    this.app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      const url = request.url;
      if (url.startsWith('/api/') || url === '/api' || url.startsWith('/ws')) {
        reply.code(404).send({ error: 'Not Found', message: `Route ${request.method}:${url} not found`, statusCode: 404 });
        return;
      }
      return (reply as FastifyReply & { sendFile: (path: string) => unknown }).sendFile('index.html');
    });
  }

  private setupApiDocs(): void {
    const openApiPath = this.resolveOpenApiPath();
    if (!openApiPath) {
      this.app.get('/api-docs', async (_request, reply) =>
        reply.code(500).send({ error: 'OpenAPI document not found' }));
      return;
    }
    this.registerApiDocs(openApiPath);
  }

  private registerApiDocs(openApiPath: string): void {
    this.app.register(require('@fastify/swagger'), { mode: 'static',
      specification: { path: openApiPath } });
    this.app.register(require('@fastify/swagger-ui'), { routePrefix: '/api-docs',
      uiConfig: { docExpansion: 'list', deepLinking: true }, staticCSP: true,
      transformStaticCSP: (header: string) => header });
  }

  private resolveOpenApiPath(): string | undefined {
    const candidates = [
      resolve(process.cwd(), 'docs/openapi.yaml'),
      resolve(process.cwd(), '../docs/openapi.yaml'),
      resolve(__dirname, '../../../docs/openapi.yaml'),
      resolve(__dirname, '../../../../docs/openapi.yaml'),
    ];

    return candidates.find((candidate) => existsSync(candidate));
  }

  private setupHealthCheck(): void {
    this.app.get('/api/status', async (_request, reply) => reply.send({ data: this.healthStatus() }));
  }

  private healthStatus(): Record<string, unknown> {
    const stats = this.options.taskManager.getStats();
    const adapters = this.options.adapterRegistry.list();
    return { version: COMICCRAWLER_VERSION, uptime: process.uptime(),
      activeTasks: stats.running, queuedTasks: stats.pending,
      memory: { used: process.memoryUsage().heapUsed, total: process.memoryUsage().heapTotal },
      adapters: { loaded: adapters.length, enabled: adapters.length } };
  }
}

function createBrowserLeaseTransfer(lease: BrowserWorkerLease) {
  let claimed = false;
  const claim: BrowserLeaseClaim = () => {
    if (claimed) throw new Error('Browser session lease was already transferred.');
    claimed = true;
    return { sessionId: lease.sessionId, release: lease.release };
  };
  return { claim, claimed: () => claimed };
}
