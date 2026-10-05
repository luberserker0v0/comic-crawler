import { EventBus } from './events/bus';
import { JsonFileStore } from './storage/json-store';
import { ConfigManager } from './config/manager';
import { resolveRuntimeConfig } from './config/runtime';
import { AdapterRegistry } from './adapter/registry';
import { registerProjectAdapters } from './adapter/runtime-state';
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

async function main(): Promise<void> {
  try {
    const eventBus = new EventBus();
    const runtime = resolveRuntimeConfig();
    const storage = new JsonFileStore({ basePath: runtime.dataPath });
    await storage.initialize();

    const configManager = new ConfigManager(storage, eventBus);
    await configManager.load();
    const config = await configManager.get();

    const adapterRegistry = new AdapterRegistry(eventBus);
    await registerProjectAdapters(
      storage,
      (adapter) => adapterRegistry.register(adapter)
    );

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
      await crawlerEngine.crawl(adapter as any, task.data.url, {
        chapters: task.data.chapters,
        chapterUrls: task.data.chapterUrls,
        taskId: task.id,
        checkpoint: taskManager.getCheckpoint(task.id),
        onCheckpoint: (checkpoint) => taskManager.updateCheckpoint(task.id, checkpoint),
      });
    };

    const taskManager = new TaskManager(executor, { concurrency: config.concurrency.taskLevel, eventBus, storage });
    await taskManager.initialize();

    const agentTriggerMonitor = new AgentTriggerMonitor(eventBus, storage);
    await agentTriggerMonitor.initialize();
    const agentAdminService = new AgentAdminService(
      runtime.agentWorkspacePath,
      storage,
      eventBus,
      new AgentNotifier(),
      agentTriggerMonitor
    );

    const selectorDiscoveryService = new SelectorDiscoveryService(storage, adapterRegistry, {
      getBrowserConfig: async () => (await configManager.get()).browser,
      getNetworkConfig: async () => (await configManager.get()).network,
    });
    await selectorDiscoveryService.loadActiveDynamicAdapters();

    const challengeDiscoveryService = new ChallengeDiscoveryService(storage, {
      workspaceRoot: runtime.agentWorkspacePath,
      getBrowserConfig: async () => (await configManager.get()).browser,
      getNetworkConfig: async () => (await configManager.get()).network,
    });

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
        browserProfilesRetainDays: 14,
        deleteFiles: true,
        deleteOrphanProfiles: true,
        batchLimit: 100,
      },
    });

    const cli = new ComicCrawlerCli({
      configManager,
      taskManager,
      adapterRegistry,
      crawlerEngine,
      agentAdminService,
      selectorDiscoveryService,
      maintenanceService,
    });

    await cli.parse(process.argv);
  } catch (error) {
    logger.error({ error: errorToLogObject(error) }, 'CLI failed');
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

void main();
