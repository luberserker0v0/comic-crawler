import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ComicCrawlerServer } from './server';
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
import { TaskManager, type TaskDefinition } from './task/manager';
import type { TaskItem } from './task/types';
import { CrawlerEngine } from './crawler/engine';
import { ComicError, ErrorType, errorToLogObject } from './error/types';
import { SelectorDiscoveryService, SelectorDiscoverySettingsStore } from './selector-discovery';
import { ChallengeDiscoveryService } from './challenge';
import { AdapterDraftService } from './adapter-drafts/service';
import { FixtureCaptureService } from './fixtures/fixture-capture-service';
import { MaintenanceService } from './maintenance/service';
import { logger } from './utils/logger';
import { BrowserClientRegistry } from './browser/browser-client-registry';
import { BrowserSessionGateway } from './browser/browser-session-gateway';
import { BrowserWorkerLeaseCoordinator, type BrowserWorkerLease } from './browser/browser-worker-lease-coordinator';
import { BrowserRenderService } from './browser/browser-render-service';
import { ConcurrentSchedulingPolicy, TaskDeferredError } from './scheduler';
import { ApiSecurityService, resolveApiSecurityPolicy } from './security/api-security';

async function main(): Promise<void> {
  try {
    const timing = createBootstrapTiming();
    const eventBus = new EventBus();
    const bootstrapRuntime = resolveRuntimeConfig();
    await ensureDataDirectoryLayout(bootstrapRuntime.dataLayout);
    const storage = new JsonFileStore({ basePath: bootstrapRuntime.dataPath });
    await storage.initialize();
    timing.mark('storage initialize');

    const configManager = new ConfigManager(storage, eventBus);
    await configManager.load();
    const config = await configManager.get();
    const runtime = resolveRuntimeConfig(config);
    const apiSecurity = await ApiSecurityService.create(resolveApiSecurityPolicy(config.apiSecurity));
    timing.mark('config load');

    const adapterRegistry = new AdapterRegistry(eventBus);
    const browserClientRegistry = new BrowserClientRegistry(storage);
    await browserClientRegistry.initialize();
    const browserSessionGateway = new BrowserSessionGateway(browserClientRegistry, apiSecurity);
    const browserLeaseCoordinator = new BrowserWorkerLeaseCoordinator(browserSessionGateway);
    const browserRenderService = new BrowserRenderService(browserSessionGateway);
    timing.mark('browser client gateway initialize');

    await registerProjectAdapters(storage, (adapter) => adapterRegistry.register(adapter));

    const challengeDiscoveryService = new ChallengeDiscoveryService(storage, {
      workspaceRoot: runtime.agentWorkspacePath,
      getBrowserConfig: async () => (await configManager.get()).browser,
      getNetworkConfig: async () => (await configManager.get()).network,
      browserRenderService,
      acquireBrowserSession: async ({ jobId, ownerUserId, url, browserTarget }) => {
        const browser = (await configManager.get()).browser;
        const lease = await browserLeaseCoordinator.acquire({
          taskId: `challenge:${jobId}`,
          ownerUserId,
          target: browserTarget,
          initialUrl: url,
          timeoutMs: browser.workerWaitTimeoutMs,
        });
        return { sessionId: lease.sessionId, release: () => lease.release() };
      },
    });
    const adapterDraftService = new AdapterDraftService(runtime.dataLayout.userPath, adapterRegistry);
    const fixtureCaptureService = new FixtureCaptureService(challengeDiscoveryService, runtime.agentWorkspacePath);
    const selectorDiscoverySettingsStore = new SelectorDiscoverySettingsStore(storage);
    const selectorDiscoveryService = new SelectorDiscoveryService(storage, adapterRegistry, {
      getBrowserConfig: async () => (await configManager.get()).browser,
      renderBrowserPage: (sessionId, url, options) =>
        browserRenderService.render(sessionId, url, { timeoutMs: options.timeoutMs }),
      acquireBrowserSession: async ({ job, browserTarget }) => {
        const lease = await browserLeaseCoordinator.acquire({
          taskId: `selector:${job.id}`,
          ownerUserId: job.ownerUserId ?? 'public',
          target: browserTarget,
          initialUrl: job.normalizedUrl,
          timeoutMs: (await configManager.get()).browser.workerWaitTimeoutMs,
        });
        return { sessionId: lease.sessionId, release: () => lease.release() };
      },
      getNetworkConfig: async () => (await configManager.get()).network,
      captureApprovalFixture: async ({ job, adapter }) => {
        const lease = await browserLeaseCoordinator.acquire({
          taskId: `selector-fixture:${job.id}`,
          ownerUserId: job.ownerUserId ?? 'public',
          target: job.browserTarget,
          initialUrl: job.normalizedUrl,
          timeoutMs: (await configManager.get()).browser.workerWaitTimeoutMs,
        });
        try {
          const page = await browserRenderService.render(lease.sessionId, job.normalizedUrl, {
            timeoutMs: (await configManager.get()).browser.timeout,
          });
          return fixtureCaptureService.captureApprovedAdapterFixture({
            sourceDiscoveryId: job.id,
            adapter,
            target: job.target ?? 'full',
            url: page.url,
            html: page.html,
          });
        } finally {
          await lease.release();
        }
      },
      schedulingPolicy: new ConcurrentSchedulingPolicy({
        maxConcurrency: config.concurrency.siteLevel,
        maxConcurrencyPerGroup: 1,
        groupBy: (task) => new URL(task.data.url).hostname,
      }),
    });

    const crawlerEngine = new CrawlerEngine({
      downloadDir: config.download.directory,
      concurrency: config.download.concurrency,
      browser: config.browser,
      network: config.network,
      browserRenderService,
      eventBus,
    });

    const executor = async (task: TaskItem<TaskDefinition>) => {
      const adapter = adapterRegistry.get(task.data.adapterId);
      if (!adapter) {
        throw new ComicError(`Adapter "${task.data.adapterId}" not found`, ErrorType.ADAPTER_ERROR);
      }

      let browserLease: BrowserWorkerLease | undefined;
      let retainLeaseForVerification = false;
      let reconnectAttempts = 0;

      try {
        const browserConfig = (await configManager.get()).browser;
        browserLease = await browserLeaseCoordinator.tryAcquire({
          taskId: task.id,
          ownerUserId: task.data.ownerUserId ?? 'public',
          target: task.data.browserTarget,
          initialUrl: task.data.url,
        });
        if (!browserLease) {
          const targetMessage = task.data.browserTarget?.mode === 'existing-tab' || task.data.browserTarget?.workerId
            ? `Waiting for browser worker "${task.data.browserTarget.workerId}".`
            : 'Waiting for an available managed-profile browser worker.';
          await taskManager.markWaitingForBrowserWorker(task.id, targetMessage);
          const waitStartedAt = Date.parse(task.data.browserWaitStartedAt ?? new Date().toISOString());
          const waitTimeoutMs = browserConfig.workerWaitTimeoutMs ?? 30 * 60 * 1000;
          const remainingMs = waitTimeoutMs - (Date.now() - waitStartedAt);
          if (remainingMs <= 0) throw new Error(targetMessage.replace(/^Waiting/, 'Timed out waiting'));
          throw new TaskDeferredError(targetMessage, Math.min(5_000, remainingMs));
        }
        await taskManager.markBrowserWorkerAcquired(task.id);
        while (true) {
          try {
            await crawlerEngine.crawl(adapter as any, task.data.url, {
              chapters: task.data.chapters,
              chapterUrls: task.data.chapterUrls,
              taskId: task.id,
              browserSessionId: browserLease.sessionId,
              checkpoint: taskManager.getCheckpoint(task.id),
              onCheckpoint: (checkpoint) => taskManager.updateCheckpoint(task.id, checkpoint),
            });
            break;
          } catch (error) {
            if (!isBrowserTransportDisconnect(error) || reconnectAttempts >= 3) throw error;
            reconnectAttempts += 1;
            await taskManager.markWaitingForBrowserWorker(task.id, `Browser worker disconnected; waiting to resume (${reconnectAttempts}/3).`);
            if (!await browserLeaseCoordinator.waitForReconnect(browserLease, 120_000)) throw error;
          }
        }
      } catch (error) {
        if (isHumanVerificationRequiredError(error)) {
          const errorUrl = error instanceof ComicError && typeof error.context.url === 'string'
            ? error.context.url
            : undefined;
          const verificationUrl = errorUrl ?? task.data.chapterUrls?.[0] ?? task.data.url;
          eventBus.emit('task:progress', {
            taskId: task.id,
            progress: {
              totalImages: 0,
              completedImages: 0,
              failedImages: 0,
              stage: 'verification',
              stageDetail: 'human verification detected; queued verification handoff',
              currentChapter: 'human verification detected; queued verification handoff',
            },
          });
          retainLeaseForVerification = true;
          const challengeJob = await challengeDiscoveryService.createDeferred({
            url: verificationUrl,
            browserLease,
            ownerUserId: task.data.ownerUserId,
            browserTarget: task.data.browserTarget,
          });
          browserLease = undefined;
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
        if (!retainLeaseForVerification) await browserLease?.release();
      }
    };

    const taskManager = new TaskManager(executor, { concurrency: config.concurrency.taskLevel, eventBus, storage });
    await taskManager.initialize();
    timing.mark('task manager initialize');
    const agentNotifier = new AgentNotifier();
    const agentTriggerMonitor = new AgentTriggerMonitor(eventBus, storage);
    await agentTriggerMonitor.initialize();
    timing.mark('agent trigger monitor initialize');
    const agentAdminService = new AgentAdminService(runtime.agentWorkspacePath, storage, eventBus, agentNotifier, agentTriggerMonitor);
    await selectorDiscoveryService.loadActiveDynamicAdapters();
    await selectorDiscoveryService.initializeScheduler();
    timing.mark('dynamic adapter load');
    await challengeDiscoveryService.loadActiveStrategies();
    timing.mark('challenge strategy load');
    const maintenanceService = new MaintenanceService({
      storage,
      taskManager,
      selectorDiscoveryService,
      challengeDiscoveryService,
      workspaceRoot: runtime.agentWorkspacePath,
      downloadDir: async () => (await configManager.get()).download.directory,
      getPolicy: async () => (await configManager.get()).maintenance ?? {
        enabled: true,
        intervalHours: 24,
        tasksRetainDays: 30,
        discoveryJobsRetainDays: 14,
        deleteFiles: true,
        batchLimit: 100,
      },
    });
    const server = new ComicCrawlerServer({
      port: runtime.port,
      host: runtime.host,
      configManager,
      taskManager,
      adapterRegistry,
      crawlerEngine,
      eventBus,
      agentAdminService,
      selectorDiscoveryService,
      selectorDiscoverySettingsStore,
      challengeDiscoveryService,
      adapterDraftService,
      fixtureCaptureService,
      maintenanceService,
      browserClientRegistry,
      browserSessionGateway,
      browserLeaseCoordinator,
      browserRenderService,
      storage,
      staticDir: runtime.staticDir,
      apiSecurity,
    });

    await server.start();
    timing.mark('server listen');
    timing.log();
    startMaintenanceScheduler(maintenanceService, configManager);
    createGracefulShutdownManager({ server, storage, logger }).register();
  } catch (error) {
    logger.fatal({ error: errorToLogObject(error) }, 'Failed to start server');
    process.exit(1);
  }
}

main();

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
  let previous = startedAt;
  const entries: Array<{ step: string; durationMs: number; totalMs: number }> = [];
  const immediate = process.env.COMICCRAWLER_BOOT_TIMING === '1';

  if (immediate) {
    writeBootstrapTiming('main entered', 0, 0);
  }

  return {
    mark(step: string) {
      const now = performance.now();
      const entry = {
        step,
        durationMs: Math.round(now - previous),
        totalMs: Math.round(now - startedAt),
      };
      entries.push(entry);
      if (immediate) {
        writeBootstrapTiming(entry.step, entry.durationMs, entry.totalMs);
      }
      previous = now;
    },
    log() {
      if (!immediate) {
        logger.info({ bootstrap: entries }, 'Backend bootstrap timing');
      }
    },
  };
}

function writeBootstrapTiming(step: string, durationMs: number, totalMs: number): void {
  process.stderr.write(`[bootstrap] ${step} +${durationMs}ms total=${totalMs}ms\n`);
}

function startMaintenanceScheduler(maintenanceService: MaintenanceService, configManager: ConfigManager): void {
  void (async () => {
    let policy;
    try {
      policy = await configManager.get().then((config) => config.maintenance);
    } catch {
      return;
    }
    if (!policy?.enabled || !policy.intervalHours || policy.intervalHours <= 0) return;
    const intervalMs = policy.intervalHours * 60 * 60 * 1000;
    const runOnce = () => {
      maintenanceService.run().catch((error) => {
        logger.warn({ error: errorToLogObject(error) }, 'Scheduled maintenance cleanup failed');
      });
    };
    // Delay the first run to avoid competing with startup work.
    const initialTimer = setTimeout(runOnce, 5 * 60 * 1000);
    initialTimer.unref?.();
    const timer = setInterval(runOnce, intervalMs);
    timer.unref?.();
  })();
}

function isHumanVerificationRequiredError(error: unknown): boolean {
  if (error instanceof ComicError) {
    return hasHumanVerificationContext(error.context);
  }
  const message = error instanceof Error ? error.message : String(error);
  return /anti-bot|human verification|challenge|cloudflare|sorry, you have been blocked|unable to access/i.test(message);
}

function hasHumanVerificationContext(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  if (
    context.antiBotChallenge === true ||
    context.challengeType === 'access_blocked' ||
    context.humanVerificationProfileUnavailable === true
  ) return true;
  return Object.values(context).some((entry) => hasHumanVerificationContext(entry));
}

function isBrowserTransportDisconnect(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /websocket|browser has been closed|browser closed|connection closed|target page, context or browser has been closed|econnreset|socket hang up/i.test(message);
}
