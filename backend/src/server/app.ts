import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ConfigManager } from '../config/manager';
import type { TaskManager } from '../task/manager';
import type { AdapterRegistry } from '../adapter/registry';
import type { CrawlerEngine } from '../crawler/engine';
import type { EventBus } from '../events/bus';
import type { AgentAdminService } from '../agent/admin-service';
import type { SelectorDiscoveryService, SelectorDiscoverySettingsStore } from '../selector-discovery';
import type { ChallengeDiscoveryService } from '../challenge';
import { setupTasksRoutes } from './routes/tasks';
import { setupConfigRoutes } from './routes/config';
import { setupAdaptersRoutes } from './routes/adapters';
import { setupSearchRoutes } from './routes/search';
import { setupAgentRoutes } from './routes/agent';
import { setupSelectorDiscoveryRoutes } from './routes/selector-discovery';
import { setupChallengeDiscoveryRoutes } from './routes/challenge-discovery';
import { setupWebSocket } from './websocket';
import { setupCors } from './middleware/cors';
import { logger } from '../utils/logger';

export interface ServerOptions {
  port: number;
  host: string;
  configManager: ConfigManager;
  taskManager: TaskManager;
  adapterRegistry: AdapterRegistry;
  crawlerEngine: CrawlerEngine;
  eventBus: EventBus;
  agentAdminService?: AgentAdminService;
  selectorDiscoveryService?: SelectorDiscoveryService;
  selectorDiscoverySettingsStore?: SelectorDiscoverySettingsStore;
  challengeDiscoveryService?: ChallengeDiscoveryService;
  staticDir?: string;
  cors?: { origin: string[] };
  auth?: { username: string; password: string };
}

export class ComicCrawlerServer {
  private app: FastifyInstance;
  private options: ServerOptions;
  private httpServer?: import('node:http').Server;

  constructor(options: ServerOptions) {
    this.options = options;
    this.app = this.createApp();
    this.setupRoutes();
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

    setupWebSocket(this.httpServer, this.options.eventBus);

    logger.info({ host: this.options.host, port: this.options.port }, 'Server started');
  }

  async stop(): Promise<void> {
    await this.app.close();
    await this.options.taskManager.dispose();
    await this.options.crawlerEngine.dispose();

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
    setupTasksRoutes(
      this.app,
      this.options.taskManager,
      this.options.adapterRegistry,
      this.options.selectorDiscoveryService,
      this.options.challengeDiscoveryService
    );
    setupConfigRoutes(this.app, this.options.configManager);
    setupAdaptersRoutes(this.app, this.options.adapterRegistry, {
      challengeDiscoveryService: this.options.challengeDiscoveryService,
    });
    setupSearchRoutes(this.app, this.options.crawlerEngine);
    if (this.options.selectorDiscoveryService && this.options.selectorDiscoverySettingsStore) {
      setupSelectorDiscoveryRoutes(
        this.app,
        this.options.selectorDiscoveryService,
        this.options.selectorDiscoverySettingsStore
      );
    }
    if (this.options.challengeDiscoveryService) {
      setupChallengeDiscoveryRoutes(
        this.app,
        this.options.challengeDiscoveryService,
        this.options.selectorDiscoveryService
      );
    }
    if (this.options.agentAdminService) {
      setupAgentRoutes(this.app, this.options.agentAdminService, this.options.adapterRegistry);
    }
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

  private setupHealthCheck(): void {
    this.app.get('/api/status', async (_request: FastifyRequest, reply: FastifyReply) => {
      const stats = this.options.taskManager.getStats();
      const adapters = this.options.adapterRegistry.list();

      reply.send({
        data: {
          version: '0.1.0',
          uptime: process.uptime(),
          activeTasks: stats.running,
          queuedTasks: stats.pending,
          memory: {
            used: process.memoryUsage().heapUsed,
            total: process.memoryUsage().heapTotal,
          },
          adapters: {
            loaded: adapters.length,
            enabled: adapters.length,
          },
        },
      });
    });
  }
}
