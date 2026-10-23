import { EventBus } from './events/bus';
import { JsonFileStore } from './storage/json-store';
import { ConfigManager } from './config/manager';
import { resolveRuntimeConfig } from './config/runtime';
import { AdapterRegistry } from './adapter/registry';
import { registerProjectAdapters } from './adapter/runtime-state';
import { AdapterCatalog } from './adapter/catalog';
import { loadCatalogAdapters } from './adapter/catalog-runtime';
import { CrawlerEngine } from './crawler/engine';
import { TaskManager, type TaskDefinition } from './task/manager';
import type { TaskItem } from './task/types';
import { AgentAdminService } from './agent/admin-service';
import { AgentNotifier } from './agent/notifier';
import { AgentTriggerMonitor } from './agent/trigger-monitor';
import { SelectorDiscoveryService } from './selector-discovery';
import { ChallengeDiscoveryService } from './challenge';
import { MaintenanceService } from './maintenance/service';
import { ComicCrawlerCli } from './cli';
import { ComicError, ErrorType, errorToLogObject } from './error/types';
import { logger } from './utils/logger';
import { FixtureCaptureService } from './fixtures/fixture-capture-service';
import type { GlobalConfig } from '@comiccrawler/shared';
import type { RuntimeConfig } from './config/runtime';
import type { IStorage } from './storage/types';
import { OfficialAdapterRegistryService } from './adapter/official-registry';

async function main(): Promise<void> {
  try {
    const cli = await createCli();
    await cli.parse(process.argv);
  } catch (error) {
    handleCliError(error);
  }
}

async function createCli(): Promise<ComicCrawlerCli> {
  const eventBus = new EventBus();
  const runtime = resolveRuntimeConfig();
  const { storage, configManager, config } = await createStorageContext(runtime, eventBus);
  const { adapterRegistry, adapterCatalog } = await createAdapterRuntime(storage, eventBus);
  const officialAdapterRegistry = new OfficialAdapterRegistryService(
    adapterCatalog, adapterRegistry, runtime.adapterTrustStorePath);
  const crawlerEngine = createCrawlerEngine(config, eventBus);
  const taskManager = await createTaskManager(storage, eventBus, config, adapterRegistry, crawlerEngine);
  const agentAdminService = await createAgentAdminService(runtime, storage, eventBus);
  const discovery = await createDiscoveryServices(
    runtime, storage, configManager, adapterRegistry, adapterCatalog);
  const maintenanceService = createMaintenanceService(runtime, storage, configManager, taskManager, discovery);
  return new ComicCrawlerCli({ configManager, taskManager, adapterRegistry, crawlerEngine,
    agentAdminService, selectorDiscoveryService: discovery.selector,
    maintenanceService, fixtureCaptureService: discovery.fixture, storage, adapterCatalog,
    officialAdapterRegistry });
}

async function createStorageContext(runtime: RuntimeConfig, eventBus: EventBus) {
  const storage = new JsonFileStore({ basePath: runtime.dataPath });
  await storage.initialize();
  const configManager = new ConfigManager(storage, eventBus);
  const config = await configManager.load();
  return { storage, configManager, config };
}

async function createAdapterRuntime(storage: IStorage, eventBus: EventBus) {
  const registry = new AdapterRegistry(eventBus);
  const catalog = new AdapterCatalog(storage);
  await catalog.initialize();
  await registerProjectAdapters(storage, (adapter) => registry.register(adapter));
  await loadCatalogAdapters(catalog, registry);
  return { adapterRegistry: registry, adapterCatalog: catalog };
}

function createCrawlerEngine(config: GlobalConfig, eventBus: EventBus): CrawlerEngine {
  return new CrawlerEngine({ downloadDir: config.download.directory,
    concurrency: config.download.concurrency, browser: config.browser,
    network: config.network, eventBus });
}

async function createTaskManager(storage: IStorage, eventBus: EventBus, config: GlobalConfig,
  registry: AdapterRegistry, crawler: CrawlerEngine): Promise<TaskManager> {
  const managerRef: { current?: TaskManager } = {};
  const executor = createTaskExecutor(registry, crawler, () => managerRef.current!);
  const manager = new TaskManager(executor, { concurrency: config.concurrency.taskLevel, eventBus, storage });
  managerRef.current = manager;
  await manager.initialize();
  return manager;
}

function createTaskExecutor(registry: AdapterRegistry, crawler: CrawlerEngine,
  getManager: () => TaskManager) {
  return async (task: TaskItem<TaskDefinition>): Promise<void> => {
    const adapter = registry.get(task.data.adapterId);
    if (!adapter) throw new ComicError(`Adapter "${task.data.adapterId}" not found`, ErrorType.ADAPTER_ERROR);
    await crawler.crawl(adapter as any, task.data.url, { chapters: task.data.chapters,
      chapterUrls: task.data.chapterUrls, taskId: task.id,
      checkpoint: getManager().getCheckpoint(task.id),
      onCheckpoint: (checkpoint) => getManager().updateCheckpoint(task.id, checkpoint) });
  };
}

async function createAgentAdminService(runtime: RuntimeConfig, storage: IStorage,
  eventBus: EventBus): Promise<AgentAdminService> {
  const monitor = new AgentTriggerMonitor(eventBus, storage);
  await monitor.initialize();
  return new AgentAdminService(runtime.agentWorkspacePath, storage, eventBus,
    new AgentNotifier(), monitor);
}

async function createDiscoveryServices(runtime: RuntimeConfig, storage: IStorage,
  configManager: ConfigManager, registry: AdapterRegistry, adapterCatalog: AdapterCatalog) {
  const options = { getBrowserConfig: async () => (await configManager.get()).browser,
    getNetworkConfig: async () => (await configManager.get()).network, adapterCatalog };
  const selector = new SelectorDiscoveryService(storage, registry, options);
  await selector.initializeScheduler();
  const challenge = new ChallengeDiscoveryService(storage,
    { workspaceRoot: runtime.agentWorkspacePath, ...options });
  const fixture = new FixtureCaptureService(challenge, runtime.agentWorkspacePath);
  return { selector, challenge, fixture };
}

function createMaintenanceService(runtime: RuntimeConfig, storage: IStorage,
  configManager: ConfigManager, taskManager: TaskManager,
  discovery: Awaited<ReturnType<typeof createDiscoveryServices>>): MaintenanceService {
  return new MaintenanceService({ storage, taskManager,
    selectorDiscoveryService: discovery.selector, challengeDiscoveryService: discovery.challenge,
    workspaceRoot: runtime.agentWorkspacePath,
    downloadDir: async () => (await configManager.get()).download.directory,
    getPolicy: async () => (await configManager.get()).maintenance ?? defaultMaintenancePolicy() });
}

function defaultMaintenancePolicy() {
  return { enabled: true, intervalHours: 24, tasksRetainDays: 30,
    discoveryJobsRetainDays: 14, deleteFiles: true, batchLimit: 100 };
}

function handleCliError(error: unknown): never {
  logger.error({ error: errorToLogObject(error) }, 'CLI failed');
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

void main();
