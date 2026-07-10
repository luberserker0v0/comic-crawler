import { promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ComicCrawlerServer } from './server';
import { AgentAdminService } from './agent/admin-service';
import { AgentNotifier } from './agent/notifier';
import { AgentTriggerMonitor } from './agent/trigger-monitor';
import { createGracefulShutdownManager } from './bootstrap/graceful-shutdown';
import { JsonFileStore } from './storage/json-store';
import { ConfigManager } from './config/manager';
import { resolveRuntimeConfig } from './config/runtime';
import { EventBus } from './events/bus';
import { AdapterRegistry } from './adapter/registry';
import { TaskManager, type TaskDefinition } from './task/manager';
import type { TaskItem } from './task/types';
import { CrawlerEngine } from './crawler/engine';
import { ComicError, ErrorType, errorToLogObject } from './error/types';
import { KuronaviAdapter } from './adapter/sites/kuronavi';
import { HappyMhAdapter } from './adapter/sites/happymh';
import { SelectorDiscoveryService, SelectorDiscoverySettingsStore } from './selector-discovery';
import { ChallengeDiscoveryService } from './challenge';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  try {
    const timing = createBootstrapTiming();
    const eventBus = new EventBus();
    const bootstrapRuntime = resolveRuntimeConfig();
    await importLegacyRuntimeState(bootstrapRuntime.dataPath);
    timing.mark('legacy runtime import');
    const storage = new JsonFileStore({ basePath: bootstrapRuntime.dataPath });
    await storage.initialize();
    timing.mark('storage initialize');

    const configManager = new ConfigManager(storage, eventBus);
    await configManager.load();
    const config = await configManager.get();
    const runtime = resolveRuntimeConfig(config);
    timing.mark('config load');

    const adapterRegistry = new AdapterRegistry(eventBus);

    const kuronaviAdapter = new KuronaviAdapter();
    adapterRegistry.register(kuronaviAdapter);
    adapterRegistry.register(new HappyMhAdapter());

    const selectorDiscoverySettingsStore = new SelectorDiscoverySettingsStore(storage);
    const selectorDiscoveryService = new SelectorDiscoveryService(storage, adapterRegistry, {
      getBrowserConfig: async () => (await configManager.get()).browser,
      getNetworkConfig: async () => (await configManager.get()).network,
    });
    const challengeDiscoveryService = new ChallengeDiscoveryService(storage, {
      workspaceRoot: runtime.agentWorkspacePath,
      getBrowserConfig: async () => (await configManager.get()).browser,
      getNetworkConfig: async () => (await configManager.get()).network,
    });

    const crawlerEngine = new CrawlerEngine({
      downloadDir: config.download.directory,
      concurrency: config.download.concurrency,
      browser: config.browser,
      network: config.network,
      eventBus,
    });

    const executor = async (task: TaskItem<TaskDefinition>) => {
      const adapter = adapterRegistry.get(task.data.adapterId);
      if (!adapter) {
        throw new ComicError(`Adapter "${task.data.adapterId}" not found`, ErrorType.ADAPTER_ERROR);
      }

      try {
        await crawlerEngine.crawl(adapter as any, task.data.url, {
          chapters: task.data.chapters,
          chapterUrls: task.data.chapterUrls,
          taskId: task.id,
          checkpoint: taskManager.getCheckpoint(task.id),
          onCheckpoint: (checkpoint) => taskManager.updateCheckpoint(task.id, checkpoint),
        });
      } catch (error) {
        if (isHumanVerificationRequiredError(error)) {
          const verificationUrl = task.data.chapterUrls?.[0] ?? task.data.url;
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
          const challengeJob = await challengeDiscoveryService.createDeferred({ url: verificationUrl });
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
    timing.mark('dynamic adapter load');
    await challengeDiscoveryService.loadActiveStrategies();
    timing.mark('challenge strategy load');
    await challengeDiscoveryService.loadVerifiedBrowserSessions();
    timing.mark('verified browser session load');
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
      staticDir: runtime.staticDir,
    });

    await server.start();
    timing.mark('server listen');
    timing.log();
    createGracefulShutdownManager({ server, storage, logger }).register();
  } catch (error) {
    logger.fatal({ error: errorToLogObject(error) }, 'Failed to start server');
    process.exit(1);
  }
}

main();

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

async function importLegacyRuntimeState(dataPath: string): Promise<void> {
  const targetDir = resolve(dataPath);
  const legacyDir = resolve(
    basename(process.cwd()).toLowerCase() === 'backend'
      ? join(process.cwd(), 'data')
      : join(process.cwd(), 'backend', 'data')
  );
  if (legacyDir === targetDir) return;

  const keys = [
    'global',
    'selector-discovery-settings',
    'selector-discovery-provider',
    'selector-discovery-active-adapters',
    'challenge-discovery-active-strategies',
  ];

  await fs.mkdir(targetDir, { recursive: true });
  for (const key of keys) {
    const fileName = `${key}.json`;
    const legacyFile = join(legacyDir, fileName);
    const targetFile = join(targetDir, fileName);
    try {
      await fs.access(targetFile);
      continue;
    } catch {
      // Target is missing; import from legacy location if it exists.
    }

    try {
      await fs.copyFile(legacyFile, targetFile);
      logger.info({ key, legacyDir, targetDir }, 'Imported legacy runtime state');
    } catch {
      // Legacy file does not exist or is unreadable; leave target absent.
    }
  }
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
