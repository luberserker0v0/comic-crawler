import type { AdapterBase } from '../adapter/base';
import { formatError } from '../error/types';
import { logger } from '../utils/logger';
import { cliMessages } from './messages';
import type { CliCommandContext } from './command-context';
import { getNestedValue, parseValue, setNestedValue } from './command-utils';

export function setupDownloadCommand(ctx: CliCommandContext): void {
  ctx.program
    .command('download')
    .description(cliMessages.commands.download.description)
    .argument('<url>', cliMessages.commands.download.urlArgument)
    .option('-c, --chapters <chapters>', cliMessages.commands.download.chaptersOption)
    .option('-o, --output <dir>', cliMessages.commands.download.outputOption)
    .option('--concurrency <n>', cliMessages.commands.download.concurrencyOption, '5')
    .action(async (url: string, options: { chapters?: string; output?: string; concurrency?: string }) => {
      try {
        logger.info({ url }, cliMessages.commands.download.startLog);

        const adapter = ctx.options.adapterRegistry.findByUrl(url) as AdapterBase | undefined;
        if (!adapter) {
          ctx.ui.renderError(cliMessages.commands.download.adapterNotFound(url));
          process.exit(1);
        }

        const chapters = options.chapters?.split(',').map((chapter) => chapter.trim()).filter(Boolean);
        const result = await ctx.options.crawlerEngine.crawl(adapter, url, { chapters });

        ctx.ui.renderSuccess(cliMessages.commands.download.success);
        ctx.ui.renderStatus(cliMessages.commands.download.totalImages, String(result.totalImages));
        ctx.ui.renderStatus(cliMessages.commands.download.downloadedImages, String(result.downloadedImages));
        ctx.ui.renderStatus(cliMessages.commands.download.failedImages, String(result.failedImages));
        ctx.ui.renderStatus(cliMessages.commands.download.outputPath, result.outputPath);
      } catch (error) {
        logger.error({ error: formatError(error) }, cliMessages.commands.download.failureLog);
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });
}

export function setupConfigCommand(ctx: CliCommandContext): void {
  const configCmd = ctx.program
    .command('config')
    .description(cliMessages.commands.config.description);

  configCmd
    .command('get')
    .description(cliMessages.commands.config.getDescription)
    .argument('[key]', cliMessages.commands.config.getKeyArgument)
    .action(async (key?: string) => {
      try {
        const config = await ctx.options.configManager.get();

        if (!key) {
          console.log(JSON.stringify(config, null, 2));
          return;
        }

        const value = getNestedValue(config as unknown as Record<string, unknown>, key);
        if (value === undefined) {
          ctx.ui.renderError(cliMessages.commands.config.keyNotFound(key));
          return;
        }

        ctx.ui.renderStatus(key, String(value));
      } catch (error) {
        logger.error({ error: formatError(error) }, cliMessages.commands.config.getFailureLog);
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });

  configCmd
    .command('set')
    .description(cliMessages.commands.config.setDescription)
    .argument('<key>', cliMessages.commands.config.setKeyArgument)
    .argument('<value>', cliMessages.commands.config.setValueArgument)
    .action(async (key: string, value: string) => {
      try {
        const config = await ctx.options.configManager.get();
        const parsedValue = parseValue(value);
        const updated = setNestedValue({ ...config } as unknown as Record<string, unknown>, key, parsedValue);

        await ctx.options.configManager.update(updated as any);
        ctx.ui.renderSuccess(cliMessages.commands.config.setSuccess(key, value));
      } catch (error) {
        logger.error({ error: formatError(error) }, cliMessages.commands.config.setFailureLog);
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });

  configCmd
    .command('reset')
    .description(cliMessages.commands.config.resetDescription)
    .action(async () => {
      try {
        await ctx.options.configManager.reset();
        ctx.ui.renderSuccess(cliMessages.commands.config.resetSuccess);
      } catch (error) {
        logger.error({ error: formatError(error) }, cliMessages.commands.config.resetFailureLog);
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });
}

export function setupStatusCommand(ctx: CliCommandContext): void {
  const statusLabels: Record<string, string> = {
    ...cliMessages.statusLabels,
    interrupted: '中斷',
  };

  ctx.program
    .command('status')
    .description(cliMessages.commands.status.description)
    .option('-a, --all', cliMessages.commands.status.allOption)
    .action(async (options: { all?: boolean }) => {
      try {
        const stats = ctx.options.taskManager.getStats();
        const tasks = ctx.options.taskManager.getAllTasks();

        ctx.ui.renderStatus(cliMessages.commands.status.totalTasks, String(stats.total));
        ctx.ui.renderStatus(cliMessages.commands.status.runningTasks, String(stats.running));
        ctx.ui.renderStatus(cliMessages.commands.status.pendingTasks, String(stats.pending));
        ctx.ui.renderStatus(cliMessages.commands.status.completedTasks, String(stats.completed));
        ctx.ui.renderStatus(cliMessages.commands.status.failedTasks, String(stats.failed));

        if (options.all && tasks.length > 0) {
          const rows = tasks.map((task) => [
            task.id.slice(0, 12),
            task.data.url.slice(0, 40),
            statusLabels[task.status] ?? task.status,
            String(task.priority),
          ]);

          ctx.ui.renderTable([...cliMessages.commands.status.tableHeaders], rows);
        }
      } catch (error) {
        logger.error({ error: formatError(error) }, cliMessages.commands.status.failureLog);
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });
}

export function setupSearchCommand(ctx: CliCommandContext): void {
  ctx.program
    .command('search')
    .description(cliMessages.commands.search.description)
    .argument('<query>', cliMessages.commands.search.queryArgument)
    .option('--adapter <id>', cliMessages.commands.search.adapterOption)
    .option('--limit <n>', cliMessages.commands.search.limitOption, '10')
    .action(async (query: string, options: { adapter?: string; limit?: string }) => {
      try {
        const adapters = options.adapter
          ? [ctx.options.adapterRegistry.get(options.adapter) as AdapterBase | undefined].filter(Boolean)
          : ctx.options.adapterRegistry.getAll() as AdapterBase[];

        if (adapters.length === 0) {
          ctx.ui.renderError(cliMessages.commands.search.adapterNotFound);
          process.exit(1);
        }

        const limit = parseInt(options.limit ?? '10', 10);
        const results = await ctx.options.crawlerEngine.search(adapters[0]!, query, { limit });

        if (results.length === 0) {
          ctx.ui.renderInfo(cliMessages.commands.search.noResults);
          return;
        }

        const rows = results.slice(0, limit).map((result) => [
          result.id.slice(0, 12),
          result.title.slice(0, 40),
          result.url.slice(0, 50),
        ]);

        ctx.ui.renderTable([...cliMessages.commands.search.tableHeaders], rows);
      } catch (error) {
        logger.error({ error: formatError(error) }, cliMessages.commands.search.failureLog);
        ctx.ui.renderError(formatError(error));
        process.exit(1);
      }
    });
}
