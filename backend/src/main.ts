import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ComicCrawlerServer, type ServerOptions } from './server';
import { AgentAdminService } from './agent/admin-service';
import { AgentNotifier } from './agent/notifier';
import { AgentTriggerMonitor } from './agent/trigger-monitor';
import { createGracefulShutdownManager } from './bootstrap/graceful-shutdown';
import { JsonFileStore } from './storage/json-store';
import { ConfigManager } from './config/manager';
import { resolveRuntimeConfig, type DataDirectoryLayout } from './config/runtime';
import { EventBus } from './events/bus';
import { AdapterRegistry } from './adapter/registry';
import { registerProjectAdapters } from './adapter/runtime-state';
import { AdapterCatalog } from './adapter/catalog';
import { OfficialAdapterRegistryService } from './adapter/official-registry';
import { loadCatalogAdapters } from './adapter/catalog-runtime';
import { migrateLegacyAdapterStorage } from './adapter/catalog-migration';
import { TaskManager } from './task/manager';
import { CrawlerEngine } from './crawler/engine';
import { errorToLogObject } from './error/types';
import { SelectorDiscoveryService, SelectorDiscoverySettingsStore } from './selector-discovery';
import { ChallengeDiscoveryService } from './challenge';
import { AdapterDraftService } from './adapter-drafts/service';
import { FixtureCaptureService } from './fixtures/fixture-capture-service';
import { MaintenanceService } from './maintenance/service';
import { logger } from './utils/logger';
import { BrowserClientRegistry } from './browser/browser-client-registry';
import { BrowserSessionGateway } from './browser/browser-session-gateway';
import { BrowserWorkerLeaseCoordinator } from './browser/browser-worker-lease-coordinator';
import { BrowserRenderService } from './browser/browser-render-service';
import { ConcurrentSchedulingPolicy } from './scheduler';
import { ApiSecurityService, resolveApiSecurityPolicy } from './security/api-security';
import { createCrawlTaskExecutor } from './bootstrap/task-executor';
import type { IComicAdapter } from '@comiccrawler/shared';
import type { SelectorDiscoveryJob } from './selector-discovery/types';

async function main(): Promise<void> {
  try {
    const application = await bootstrapApplication();
    await startApplication(application);
  } catch (error) {
    logger.fatal({ error: errorToLogObject(error) }, 'Failed to start server');
    process.exit(1);
  }
}

main();

async function bootstrapApplication() {
  const timing = createBootstrapTiming();
  const eventBus = new EventBus();
  const storage = await initializeStorage(timing);
  const configuration = await initializeConfiguration(storage, eventBus, timing);
  const adapters = await initializeAdapters(storage, eventBus);
  const { adapterRegistry, adapterCatalog } = adapters;
  const officialAdapterRegistry = createOfficialAdapterRegistry(adapterCatalog, adapterRegistry, configuration.runtime.adapterTrustStorePath);
  const browser = await initializeBrowserServices(storage, configuration.apiSecurity, timing);
  const discovery = createDiscoveryServices(storage, adapterRegistry, adapterCatalog, configuration, browser);
  const crawlerEngine = createCrawlerEngine(configuration.config, browser.browserRenderService, eventBus);
  const taskManager = await initializeTaskManager(storage, configuration, browser, discovery,
    adapterRegistry, crawlerEngine, eventBus, timing);
  const agentAdminService = await initializeAgentServices(configuration.runtime.agentWorkspacePath,
    storage, eventBus, timing);
  await initializeDiscoveryRuntime(discovery, timing);
  const maintenanceService = createMaintenanceService(storage, taskManager, discovery, configuration);
  return { timing, eventBus, storage, ...configuration, ...adapters, officialAdapterRegistry, ...browser,
    ...discovery, crawlerEngine, taskManager, agentAdminService, maintenanceService };
}

function createOfficialAdapterRegistry(catalog: AdapterCatalog, registry: AdapterRegistry,
  trustStorePath: string): OfficialAdapterRegistryService {
  return new OfficialAdapterRegistryService(catalog, registry, trustStorePath);
}

type BootstrapTiming = ReturnType<typeof createBootstrapTiming>;

async function initializeStorage(timing: BootstrapTiming): Promise<JsonFileStore> {
  const runtime = resolveRuntimeConfig();
  await ensureDataDirectoryLayout(runtime.dataLayout);
  const storage = new JsonFileStore({ basePath: runtime.dataPath });
  await storage.initialize();
  timing.mark('storage initialize');
  return storage;
}

async function initializeAdapters(storage: JsonFileStore, eventBus: EventBus) {
  const registry = new AdapterRegistry(eventBus);
  const catalog = new AdapterCatalog(storage);
  await catalog.initialize();
  await migrateLegacyAdapterStorage(storage, catalog);
  await registerProjectAdapters(storage, (adapter) => registry.register(adapter));
  await loadCatalogAdapters(catalog, registry);
  return { adapterRegistry: registry, adapterCatalog: catalog };
}

async function initializeConfiguration(storage: JsonFileStore, eventBus: EventBus, timing: BootstrapTiming) {
  const configManager = new ConfigManager(storage, eventBus);
  await configManager.load();
  const config = await configManager.get();
  const runtime = resolveRuntimeConfig(config);
  const apiSecurity = await ApiSecurityService.create(resolveApiSecurityPolicy(config.apiSecurity));
  timing.mark('config load');
  return { configManager, config, runtime, apiSecurity };
}

async function initializeBrowserServices(
  storage: JsonFileStore, apiSecurity: ApiSecurityService, timing: BootstrapTiming
) {
  const browserClientRegistry = new BrowserClientRegistry(storage);
  await browserClientRegistry.initialize();
  const browserSessionGateway = new BrowserSessionGateway(browserClientRegistry, apiSecurity);
  const browserLeaseCoordinator = new BrowserWorkerLeaseCoordinator(browserSessionGateway);
  const browserRenderService = new BrowserRenderService(browserSessionGateway);
  timing.mark('browser client gateway initialize');
  return { browserClientRegistry, browserSessionGateway, browserLeaseCoordinator, browserRenderService };
}

type ConfigurationRuntime = Awaited<ReturnType<typeof initializeConfiguration>>;
type BrowserRuntime = Awaited<ReturnType<typeof initializeBrowserServices>>;

function createDiscoveryServices(
  storage: JsonFileStore, adapterRegistry: AdapterRegistry, adapterCatalog: AdapterCatalog,
  configuration: ConfigurationRuntime, browser: BrowserRuntime
) {
  const challengeDiscoveryService = createChallengeDiscoveryService(storage, configuration, browser);
  const adapterDraftService = new AdapterDraftService(
    configuration.runtime.dataLayout.userPath, adapterRegistry);
  const fixtureCaptureService = new FixtureCaptureService(
    challengeDiscoveryService, configuration.runtime.agentWorkspacePath);
  const selectorDiscoverySettingsStore = new SelectorDiscoverySettingsStore(storage);
  const selectorDiscoveryService = createSelectorDiscoveryService(storage, adapterRegistry,
    adapterCatalog, configuration, browser, fixtureCaptureService);
  return { challengeDiscoveryService, adapterDraftService, fixtureCaptureService,
    selectorDiscoverySettingsStore, selectorDiscoveryService };
}

function createChallengeDiscoveryService(
  storage: JsonFileStore, configuration: ConfigurationRuntime, browser: BrowserRuntime
): ChallengeDiscoveryService {
  return new ChallengeDiscoveryService(storage, {
    workspaceRoot: configuration.runtime.agentWorkspacePath,
    getBrowserConfig: async () => (await configuration.configManager.get()).browser,
    getNetworkConfig: async () => (await configuration.configManager.get()).network,
    browserRenderService: browser.browserRenderService,
    acquireBrowserSession: (input) => acquireChallengeBrowserSession(configuration, browser, input),
  });
}

async function acquireChallengeBrowserSession(
  configuration: ConfigurationRuntime, browser: BrowserRuntime,
  input: { jobId: string; ownerUserId?: string; url: string; browserTarget?: any }
) {
  const config = (await configuration.configManager.get()).browser;
  const lease = await browser.browserLeaseCoordinator.acquire({ taskId: `challenge:${input.jobId}`,
    ownerUserId: input.ownerUserId ?? 'public', target: input.browserTarget, initialUrl: input.url,
    timeoutMs: config.workerWaitTimeoutMs });
  return { sessionId: lease.sessionId, release: () => lease.release() };
}

function createSelectorDiscoveryService(
  storage: JsonFileStore, registry: AdapterRegistry, adapterCatalog: AdapterCatalog,
  configuration: ConfigurationRuntime,
  browser: BrowserRuntime, fixtureCaptureService: FixtureCaptureService
): SelectorDiscoveryService {
  return new SelectorDiscoveryService(storage, registry, {
    adapterCatalog,
    getBrowserConfig: async () => (await configuration.configManager.get()).browser,
    getNetworkConfig: async () => (await configuration.configManager.get()).network,
    renderBrowserPage: (sessionId, url, options) => browser.browserRenderService.render(
      sessionId, url, { timeoutMs: options.timeoutMs }),
    acquireBrowserSession: (input) => acquireSelectorBrowserSession(configuration, browser, input),
    captureApprovalFixture: (input) => captureApprovalFixture(
      configuration, browser, fixtureCaptureService, input),
    schedulingPolicy: new ConcurrentSchedulingPolicy({
      maxConcurrency: configuration.config.concurrency.siteLevel, maxConcurrencyPerGroup: 1,
      groupBy: (task) => new URL(task.data.url).hostname }),
  });
}

async function acquireSelectorBrowserSession(
  configuration: ConfigurationRuntime, browser: BrowserRuntime,
  input: { job: SelectorDiscoveryJob; browserTarget?: any }
) {
  const timeoutMs = (await configuration.configManager.get()).browser.workerWaitTimeoutMs;
  const lease = await browser.browserLeaseCoordinator.acquire({ taskId: `selector:${input.job.id}`,
    ownerUserId: input.job.ownerUserId ?? 'public', target: input.browserTarget,
    initialUrl: input.job.normalizedUrl, timeoutMs });
  return { sessionId: lease.sessionId, release: () => lease.release() };
}

async function captureApprovalFixture(
  configuration: ConfigurationRuntime, browser: BrowserRuntime, service: FixtureCaptureService,
  input: { job: SelectorDiscoveryJob; adapter: IComicAdapter }
) {
  const browserConfig = (await configuration.configManager.get()).browser;
  const lease = await browser.browserLeaseCoordinator.acquire({ taskId: `selector-fixture:${input.job.id}`,
    ownerUserId: input.job.ownerUserId ?? 'public', target: input.job.browserTarget,
    initialUrl: input.job.normalizedUrl, timeoutMs: browserConfig.workerWaitTimeoutMs });
  try {
    const page = await browser.browserRenderService.render(lease.sessionId, input.job.normalizedUrl,
      { timeoutMs: browserConfig.timeout });
    return service.captureApprovedAdapterFixture({ sourceDiscoveryId: input.job.id,
      adapter: input.adapter, target: input.job.target ?? 'full', url: page.url, html: page.html });
  } finally { await lease.release(); }
}

function createCrawlerEngine(
  config: ConfigurationRuntime['config'], browserRenderService: BrowserRenderService, eventBus: EventBus
): CrawlerEngine {
  return new CrawlerEngine({ downloadDir: config.download.directory,
    concurrency: config.download.concurrency, browser: config.browser, network: config.network,
    browserRenderService, eventBus });
}

type DiscoveryRuntime = ReturnType<typeof createDiscoveryServices>;

async function initializeTaskManager(
  storage: JsonFileStore, configuration: ConfigurationRuntime, browser: BrowserRuntime,
  discovery: DiscoveryRuntime, registry: AdapterRegistry, crawler: CrawlerEngine,
  eventBus: EventBus, timing: BootstrapTiming
): Promise<TaskManager> {
  const holder: { taskManager?: TaskManager } = {};
  const executor = createCrawlTaskExecutor({ adapterRegistry: registry,
    configManager: configuration.configManager, browserLeaseCoordinator: browser.browserLeaseCoordinator,
    crawlerEngine: crawler, eventBus, challengeDiscoveryService: discovery.challengeDiscoveryService,
    getTaskManager: () => holder.taskManager! });
  const taskManager = new TaskManager(executor, { concurrency: configuration.config.concurrency.taskLevel,
    eventBus, storage });
  holder.taskManager = taskManager;
  await taskManager.initialize();
  timing.mark('task manager initialize');
  return taskManager;
}

async function initializeAgentServices(
  workspace: string, storage: JsonFileStore, eventBus: EventBus, timing: BootstrapTiming
): Promise<AgentAdminService> {
  const notifier = new AgentNotifier();
  const monitor = new AgentTriggerMonitor(eventBus, storage);
  await monitor.initialize();
  timing.mark('agent trigger monitor initialize');
  return new AgentAdminService(workspace, storage, eventBus, notifier, monitor);
}

async function initializeDiscoveryRuntime(discovery: DiscoveryRuntime, timing: BootstrapTiming): Promise<void> {
  await discovery.selectorDiscoveryService.initializeScheduler();
  timing.mark('adapter catalog load');
  await discovery.challengeDiscoveryService.loadActiveStrategies();
  timing.mark('challenge strategy load');
}

function createMaintenanceService(
  storage: JsonFileStore, taskManager: TaskManager, discovery: DiscoveryRuntime,
  configuration: ConfigurationRuntime
): MaintenanceService {
  return new MaintenanceService({ storage, taskManager,
    selectorDiscoveryService: discovery.selectorDiscoveryService,
    challengeDiscoveryService: discovery.challengeDiscoveryService,
    workspaceRoot: configuration.runtime.agentWorkspacePath,
    downloadDir: async () => (await configuration.configManager.get()).download.directory,
    getPolicy: async () => (await configuration.configManager.get()).maintenance ?? defaultMaintenancePolicy() });
}

function defaultMaintenancePolicy() {
  return { enabled: true, intervalHours: 24, tasksRetainDays: 30,
    discoveryJobsRetainDays: 14, deleteFiles: true, batchLimit: 100 };
}

type ApplicationRuntime = Awaited<ReturnType<typeof bootstrapApplication>>;

async function startApplication(application: ApplicationRuntime): Promise<void> {
  const server = new ComicCrawlerServer(createServerOptions(application));
  await server.start();
  application.timing.mark('server listen');
  application.timing.log();
  startMaintenanceScheduler(application.maintenanceService, application.configManager);
  createGracefulShutdownManager({ server, storage: application.storage, logger }).register();
}

function createServerOptions(app: ApplicationRuntime): ServerOptions {
  const runtime = { port: app.runtime.port, host: app.runtime.host,
    staticDir: app.runtime.staticDir, apiSecurity: app.apiSecurity, storage: app.storage,
    adapterCatalog: app.adapterCatalog, officialAdapterRegistry: app.officialAdapterRegistry };
  const core = { configManager: app.configManager, taskManager: app.taskManager,
    adapterRegistry: app.adapterRegistry, crawlerEngine: app.crawlerEngine, eventBus: app.eventBus };
  const discovery = { agentAdminService: app.agentAdminService,
    selectorDiscoveryService: app.selectorDiscoveryService,
    selectorDiscoverySettingsStore: app.selectorDiscoverySettingsStore,
    challengeDiscoveryService: app.challengeDiscoveryService,
    adapterDraftService: app.adapterDraftService, fixtureCaptureService: app.fixtureCaptureService,
    maintenanceService: app.maintenanceService };
  const browser = { browserClientRegistry: app.browserClientRegistry,
    browserSessionGateway: app.browserSessionGateway,
    browserLeaseCoordinator: app.browserLeaseCoordinator, browserRenderService: app.browserRenderService };
  return { ...runtime, ...core, ...discovery, ...browser };
}

async function ensureDataDirectoryLayout(layout: DataDirectoryLayout): Promise<void> {
  await Promise.all([
    fs.mkdir(layout.root, { recursive: true }),
    fs.mkdir(layout.configPath, { recursive: true }),
    fs.mkdir(layout.userPath, { recursive: true }),
    fs.mkdir(layout.runtimePath, { recursive: true }),
    fs.mkdir(layout.agentWorkspacePath, { recursive: true }),
    fs.mkdir(layout.logsPath, { recursive: true }),
  ]);
}

function createBootstrapTiming() {
  const startedAt = performance.now();
  const state: BootstrapTimingState = { startedAt, previous: startedAt, entries: [],
    immediate: process.env.COMICCRAWLER_BOOT_TIMING === '1' };
  if (state.immediate) writeBootstrapTiming('main entered', 0, 0);
  return {
    mark: (step: string) => markBootstrapTiming(state, step),
    log: () => logBootstrapTiming(state),
  };
}

interface BootstrapTimingState {
  startedAt: number; previous: number; immediate: boolean;
  entries: Array<{ step: string; durationMs: number; totalMs: number }>;
}

function markBootstrapTiming(state: BootstrapTimingState, step: string): void {
  const now = performance.now();
  const entry = { step, durationMs: Math.round(now - state.previous),
    totalMs: Math.round(now - state.startedAt) };
  state.entries.push(entry);
  if (state.immediate) writeBootstrapTiming(entry.step, entry.durationMs, entry.totalMs);
  state.previous = now;
}

function logBootstrapTiming(state: BootstrapTimingState): void {
  if (!state.immediate) logger.info({ bootstrap: state.entries }, 'Backend bootstrap timing');
}

function writeBootstrapTiming(step: string, durationMs: number, totalMs: number): void {
  process.stderr.write(`[bootstrap] ${step} +${durationMs}ms total=${totalMs}ms\n`);
}

function startMaintenanceScheduler(maintenanceService: MaintenanceService, configManager: ConfigManager): void {
  void configureMaintenanceScheduler(maintenanceService, configManager);
}

async function configureMaintenanceScheduler(
  service: MaintenanceService, configManager: ConfigManager
): Promise<void> {
  let policy;
  try { policy = (await configManager.get()).maintenance; } catch { return; }
  if (!policy?.enabled || !policy.intervalHours || policy.intervalHours <= 0) return;
  const run = () => service.run().catch((error) => logger.warn(
    { error: errorToLogObject(error) }, 'Scheduled maintenance cleanup failed'));
  const initialTimer = setTimeout(run, 5 * 60 * 1000);
  initialTimer.unref?.();
  const timer = setInterval(run, policy.intervalHours * 60 * 60 * 1000);
  timer.unref?.();
}
