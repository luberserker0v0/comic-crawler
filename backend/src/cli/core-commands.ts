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
    .action((url: string, options: DownloadOptions) => runDownload(ctx, url, options));
}

interface DownloadOptions { chapters?: string; output?: string; concurrency?: string }

async function runDownload(ctx: CliCommandContext, url: string, options: DownloadOptions): Promise<void> {
  try {
    logger.info({ url }, cliMessages.commands.download.startLog);
    const adapter = ctx.options.adapterRegistry.findByUrl(url) as AdapterBase | undefined;
    if (!adapter) throw new Error(cliMessages.commands.download.adapterNotFound(url));
    const chapters = options.chapters?.split(',').map((chapter) => chapter.trim()).filter(Boolean);
    const result = await ctx.options.crawlerEngine.crawl(adapter, url, { chapters });
    renderDownloadResult(ctx, result);
  } catch (error) { handleCliError(ctx, error, cliMessages.commands.download.failureLog); }
}

function renderDownloadResult(ctx: CliCommandContext, result: Awaited<ReturnType<CliCommandContext['options']['crawlerEngine']['crawl']>>): void {
  ctx.ui.renderSuccess(cliMessages.commands.download.success);
  ctx.ui.renderStatus(cliMessages.commands.download.totalImages, String(result.totalImages));
  ctx.ui.renderStatus(cliMessages.commands.download.downloadedImages, String(result.downloadedImages));
  ctx.ui.renderStatus(cliMessages.commands.download.failedImages, String(result.failedImages));
  ctx.ui.renderStatus(cliMessages.commands.download.outputPath, result.outputPath);
}

export function setupConfigCommand(ctx: CliCommandContext): void {
  const configCmd = ctx.program
    .command('config')
    .description(cliMessages.commands.config.description);
  setupConfigGetCommand(configCmd, ctx);
  setupConfigSetCommand(configCmd, ctx);
  setupConfigResetCommand(configCmd, ctx);
}

function setupConfigGetCommand(configCmd: CliCommandContext['program'], ctx: CliCommandContext): void {
  configCmd
    .command('get')
    .description(cliMessages.commands.config.getDescription)
    .argument('[key]', cliMessages.commands.config.getKeyArgument)
    .action((key?: string) => getConfig(ctx, key));
}

async function getConfig(ctx: CliCommandContext, key?: string): Promise<void> {
  try {
    const config = await ctx.options.configManager.get();
    if (!key) return console.log(JSON.stringify(config, null, 2));
    const value = getNestedValue(config as unknown as Record<string, unknown>, key);
    if (value === undefined) return ctx.ui.renderError(cliMessages.commands.config.keyNotFound(key));
    ctx.ui.renderStatus(key, String(value));
  } catch (error) { handleCliError(ctx, error, cliMessages.commands.config.getFailureLog); }
}

function setupConfigSetCommand(configCmd: CliCommandContext['program'], ctx: CliCommandContext): void {
  configCmd
    .command('set')
    .description(cliMessages.commands.config.setDescription)
    .argument('<key>', cliMessages.commands.config.setKeyArgument)
    .argument('<value>', cliMessages.commands.config.setValueArgument)
    .action((key: string, value: string) => setConfig(ctx, key, value));
}

async function setConfig(ctx: CliCommandContext, key: string, value: string): Promise<void> {
  try {
    const config = await ctx.options.configManager.get();
    const parsedValue = parseValue(value);
    const updated = setNestedValue({ ...config } as unknown as Record<string, unknown>, key, parsedValue);
    await ctx.options.configManager.update(updated as any);
    ctx.ui.renderSuccess(cliMessages.commands.config.setSuccess(key, value));
  } catch (error) { handleCliError(ctx, error, cliMessages.commands.config.setFailureLog); }
}

function setupConfigResetCommand(configCmd: CliCommandContext['program'], ctx: CliCommandContext): void {
  configCmd
    .command('reset')
    .description(cliMessages.commands.config.resetDescription)
    .action(() => resetConfig(ctx));
}

async function resetConfig(ctx: CliCommandContext): Promise<void> {
  try {
    await ctx.options.configManager.reset();
    ctx.ui.renderSuccess(cliMessages.commands.config.resetSuccess);
  } catch (error) { handleCliError(ctx, error, cliMessages.commands.config.resetFailureLog); }
}

export function setupStatusCommand(ctx: CliCommandContext): void {
  ctx.program
    .command('status')
    .description(cliMessages.commands.status.description)
    .option('-a, --all', cliMessages.commands.status.allOption)
    .action((options: { all?: boolean }) => renderStatus(ctx, options.all));
}

function renderStatus(ctx: CliCommandContext, showAll?: boolean): void {
  try {
    const stats = ctx.options.taskManager.getStats();
    renderTaskStats(ctx, stats);
    const tasks = ctx.options.taskManager.getAllTasks();
    if (showAll && tasks.length > 0) renderTaskTable(ctx, tasks);
  } catch (error) { handleCliError(ctx, error, cliMessages.commands.status.failureLog); }
}

function renderTaskStats(ctx: CliCommandContext, stats: ReturnType<CliCommandContext['options']['taskManager']['getStats']>): void {
  ctx.ui.renderStatus(cliMessages.commands.status.totalTasks, String(stats.total));
  ctx.ui.renderStatus(cliMessages.commands.status.runningTasks, String(stats.running));
  ctx.ui.renderStatus(cliMessages.commands.status.pendingTasks, String(stats.pending));
  ctx.ui.renderStatus(cliMessages.commands.status.completedTasks, String(stats.completed));
  ctx.ui.renderStatus(cliMessages.commands.status.failedTasks, String(stats.failed));
}

function renderTaskTable(ctx: CliCommandContext, tasks: ReturnType<CliCommandContext['options']['taskManager']['getAllTasks']>): void {
  const labels: Record<string, string> = { ...cliMessages.statusLabels, interrupted: '中斷' };
  const rows = tasks.map((task) => [task.id.slice(0, 12), task.data.url.slice(0, 40),
    labels[task.status] ?? task.status, String(task.priority)]);
  ctx.ui.renderTable([...cliMessages.commands.status.tableHeaders], rows);
}

export function setupSearchCommand(ctx: CliCommandContext): void {
  ctx.program
    .command('search')
    .description(cliMessages.commands.search.description)
    .argument('<query>', cliMessages.commands.search.queryArgument)
    .option('--adapter <id>', cliMessages.commands.search.adapterOption)
    .option('--limit <n>', cliMessages.commands.search.limitOption, '10')
    .action((query: string, options: { adapter?: string; limit?: string }) => runSearch(ctx, query, options));
}

async function runSearch(
  ctx: CliCommandContext, query: string, options: { adapter?: string; limit?: string }
): Promise<void> {
  try {
    const adapters = getSearchAdapters(ctx, options.adapter);
    if (adapters.length === 0) throw new Error(cliMessages.commands.search.adapterNotFound);
    const limit = parseInt(options.limit ?? '10', 10);
    const results = await ctx.options.crawlerEngine.search(adapters[0]!, query, { limit });
    if (results.length === 0) return ctx.ui.renderInfo(cliMessages.commands.search.noResults);
    const rows = results.slice(0, limit).map((result) => [result.id.slice(0, 12),
      result.title.slice(0, 40), result.url.slice(0, 50)]);
    ctx.ui.renderTable([...cliMessages.commands.search.tableHeaders], rows);
  } catch (error) { handleCliError(ctx, error, cliMessages.commands.search.failureLog); }
}

function getSearchAdapters(ctx: CliCommandContext, adapterId?: string): AdapterBase[] {
  if (!adapterId) return ctx.options.adapterRegistry.getAll() as AdapterBase[];
  const adapter = ctx.options.adapterRegistry.get(adapterId) as AdapterBase | undefined;
  return adapter ? [adapter] : [];
}

function handleCliError(ctx: CliCommandContext, error: unknown, logMessage: string): never {
  logger.error({ error: formatError(error) }, logMessage);
  ctx.ui.renderError(formatError(error));
  process.exit(1);
}
