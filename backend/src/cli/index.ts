import { Command } from 'commander';
import type { ConfigManager } from '../config/manager';
import type { TaskManager } from '../task/manager';
import type { AdapterRegistry } from '../adapter/registry';
import type { CrawlerEngine } from '../crawler/engine';
import type { AgentAdminService } from '../agent/admin-service';
import type { AdapterBase } from '../adapter/base';
import type { SelectorDiscoveryService } from '../selector-discovery';
import { SelectorDiscoveryBundleManager } from '../selector-discovery';
import { evaluateSelectorDiscoveryEvalPolicy, loadSelectorDiscoveryEvalCases, type SelectorDiscoveryEvalCase, type SelectorDiscoveryEvalPolicyResult } from '../selector-discovery/eval-suite';
import { assertModelExists, fingerprintProviderDocument, validateProviderDocument } from '../selector-discovery/provider-config';
import type { ProviderDocument, SelectorDiscoveryJob } from '../selector-discovery/types';
import { TerminalUI } from './ui';
import { formatError } from '../error/types';
import { logger } from '../utils/logger';
import { cliMessages } from './messages';
import { enableCliUtf8 } from './encoding';
import { agentCliMessages } from './agent-messages';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { resolveRuntimeConfig } from '../config/runtime';

export { TerminalUI } from './ui';

export interface CliOptions {
  configManager: ConfigManager;
  taskManager: TaskManager;
  adapterRegistry: AdapterRegistry;
  crawlerEngine: CrawlerEngine;
  agentAdminService: AgentAdminService;
  selectorDiscoveryService?: SelectorDiscoveryService;
}

class BundleEvalPolicyError extends Error {
  constructor(
    message: string,
    readonly summaryPath: string,
    readonly summary: any
  ) {
    super(message);
    this.name = 'BundleEvalPolicyError';
  }
}

interface SelectorDiscoveryEvalRunResult {
  case?: SelectorDiscoveryEvalCase;
  runIndex: number;
  passed: boolean;
  job?: SelectorDiscoveryJob;
  reasons: string[];
  rejection?: string;
}

export class ComicCrawlerCli {
  private program: Command;
  private ui: TerminalUI;
  private options: CliOptions;

  constructor(options: CliOptions) {
    this.options = options;
    this.ui = new TerminalUI();
    this.program = new Command();
    enableCliUtf8();
    this.setupCommands();
  }

  private setupCommands(): void {
    this.program
      .name('comiccrawler')
      .description(cliMessages.appDescription)
      .version('0.1.0');

    this.setupDownloadCommand();
    this.setupConfigCommand();
    this.setupStatusCommand();
    this.setupSearchCommand();
    this.setupDiscoverCommand();
    this.setupAgentCommand();
  }

  private setupDownloadCommand(): void {
    this.program
      .command('download')
      .description(cliMessages.commands.download.description)
      .argument('<url>', cliMessages.commands.download.urlArgument)
      .option('-c, --chapters <chapters>', cliMessages.commands.download.chaptersOption)
      .option('-o, --output <dir>', cliMessages.commands.download.outputOption)
      .option('--concurrency <n>', cliMessages.commands.download.concurrencyOption, '5')
      .action(async (url: string, options: { chapters?: string; output?: string; concurrency?: string }) => {
        try {
          logger.info({ url }, cliMessages.commands.download.startLog);

          const adapter = this.options.adapterRegistry.findByUrl(url) as AdapterBase | undefined;
          if (!adapter) {
            this.ui.renderError(cliMessages.commands.download.adapterNotFound(url));
            process.exit(1);
          }

          const chapters = options.chapters?.split(',').map((chapter) => chapter.trim()).filter(Boolean);
          const result = await this.options.crawlerEngine.crawl(adapter, url, { chapters });

          this.ui.renderSuccess(cliMessages.commands.download.success);
          this.ui.renderStatus(cliMessages.commands.download.totalImages, String(result.totalImages));
          this.ui.renderStatus(cliMessages.commands.download.downloadedImages, String(result.downloadedImages));
          this.ui.renderStatus(cliMessages.commands.download.failedImages, String(result.failedImages));
          this.ui.renderStatus(cliMessages.commands.download.outputPath, result.outputPath);
        } catch (error) {
          logger.error({ error: formatError(error) }, cliMessages.commands.download.failureLog);
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });
  }

  private setupConfigCommand(): void {
    const configCmd = this.program
      .command('config')
      .description(cliMessages.commands.config.description);

    configCmd
      .command('get')
      .description(cliMessages.commands.config.getDescription)
      .argument('[key]', cliMessages.commands.config.getKeyArgument)
      .action(async (key?: string) => {
        try {
          const config = await this.options.configManager.get();

          if (!key) {
            console.log(JSON.stringify(config, null, 2));
            return;
          }

          const value = this.getNestedValue(config as unknown as Record<string, unknown>, key);
          if (value === undefined) {
            this.ui.renderError(cliMessages.commands.config.keyNotFound(key));
            return;
          }

          this.ui.renderStatus(key, String(value));
        } catch (error) {
          logger.error({ error: formatError(error) }, cliMessages.commands.config.getFailureLog);
          this.ui.renderError(formatError(error));
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
          const config = await this.options.configManager.get();
          const parsedValue = this.parseValue(value);
          const updated = this.setNestedValue({ ...config } as unknown as Record<string, unknown>, key, parsedValue);

          await this.options.configManager.update(updated as any);
          this.ui.renderSuccess(cliMessages.commands.config.setSuccess(key, value));
        } catch (error) {
          logger.error({ error: formatError(error) }, cliMessages.commands.config.setFailureLog);
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });

    configCmd
      .command('reset')
      .description(cliMessages.commands.config.resetDescription)
      .action(async () => {
        try {
          await this.options.configManager.reset();
          this.ui.renderSuccess(cliMessages.commands.config.resetSuccess);
        } catch (error) {
          logger.error({ error: formatError(error) }, cliMessages.commands.config.resetFailureLog);
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });
  }

  private setupStatusCommand(): void {
    const statusLabels: Record<string, string> = {
      ...cliMessages.statusLabels,
      interrupted: '中斷',
    };

    this.program
      .command('status')
      .description(cliMessages.commands.status.description)
      .option('-a, --all', cliMessages.commands.status.allOption)
      .action(async (options: { all?: boolean }) => {
        try {
          const stats = this.options.taskManager.getStats();
          const tasks = this.options.taskManager.getAllTasks();

          this.ui.renderStatus(cliMessages.commands.status.totalTasks, String(stats.total));
          this.ui.renderStatus(cliMessages.commands.status.runningTasks, String(stats.running));
          this.ui.renderStatus(cliMessages.commands.status.pendingTasks, String(stats.pending));
          this.ui.renderStatus(cliMessages.commands.status.completedTasks, String(stats.completed));
          this.ui.renderStatus(cliMessages.commands.status.failedTasks, String(stats.failed));

          if (options.all && tasks.length > 0) {
            const rows = tasks.map((task) => [
              task.id.slice(0, 12),
              task.data.url.slice(0, 40),
              statusLabels[task.status] ?? task.status,
              String(task.priority),
            ]);

            this.ui.renderTable([...cliMessages.commands.status.tableHeaders], rows);
          }
        } catch (error) {
          logger.error({ error: formatError(error) }, cliMessages.commands.status.failureLog);
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });
  }

  private setupSearchCommand(): void {
    this.program
      .command('search')
      .description(cliMessages.commands.search.description)
      .argument('<query>', cliMessages.commands.search.queryArgument)
      .option('--adapter <id>', cliMessages.commands.search.adapterOption)
      .option('--limit <n>', cliMessages.commands.search.limitOption, '10')
      .action(async (query: string, options: { adapter?: string; limit?: string }) => {
        try {
          const adapters = options.adapter
            ? [this.options.adapterRegistry.get(options.adapter) as AdapterBase | undefined].filter(Boolean)
            : this.options.adapterRegistry.getAll() as AdapterBase[];

          if (adapters.length === 0) {
            this.ui.renderError(cliMessages.commands.search.adapterNotFound);
            process.exit(1);
          }

          const limit = parseInt(options.limit ?? '10', 10);
          const results = await this.options.crawlerEngine.search(adapters[0]!, query, { limit });

          if (results.length === 0) {
            this.ui.renderInfo(cliMessages.commands.search.noResults);
            return;
          }

          const rows = results.slice(0, limit).map((result) => [
            result.id.slice(0, 12),
            result.title.slice(0, 40),
            result.url.slice(0, 50),
          ]);

          this.ui.renderTable([...cliMessages.commands.search.tableHeaders], rows);
        } catch (error) {
          logger.error({ error: formatError(error) }, cliMessages.commands.search.failureLog);
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });
  }

  private setupDiscoverCommand(): void {
    this.program
      .command('discover')
      .description('Discover selectors for a comic URL through AO selector-discovery')
      .argument('<url>', 'Comic metadata URL')
      .requiredOption('--ao-url <url>', 'AO base URL')
      .requiredOption('--provider-json <path>', 'Provider JSON file with a top-level provider field')
      .requiredOption('--model <model>', 'OpenCode model id in <provider>/<model> format')
      .option('--target <target>', 'Discovery target: full or chapter-only', 'full')
      .option('--handoff <mode>', 'Browser handoff mode: snapshot, cdp, or managed')
      .option('--html-snapshot <path>', 'Rendered chapter HTML snapshot file for chapter-only discovery')
      .option('--cdp-url <url>', 'Local user browser CDP endpoint, for example http://127.0.0.1:9222')
      .option('--force-discovery', 'Run AO discovery even when a registered adapter already matches the URL')
      .action(async (url: string, options: {
        aoUrl: string;
        providerJson: string;
        model: string;
        target?: string;
        handoff?: string;
        htmlSnapshot?: string;
        cdpUrl?: string;
        forceDiscovery?: boolean;
      }) => {
        try {
          if (!this.options.selectorDiscoveryService) {
            this.ui.renderError('Selector discovery service is not available in this CLI context.');
            process.exit(1);
          }
          if (options.target !== 'full' && options.target !== 'chapter-only') {
            throw new Error('Discovery target must be "full" or "chapter-only".');
          }
          if (options.handoff && !['snapshot', 'cdp', 'managed'].includes(options.handoff)) {
            throw new Error('Handoff mode must be "snapshot", "cdp", or "managed".');
          }
          const providerDocument = validateProviderDocument(JSON.parse(await fs.readFile(options.providerJson, 'utf-8')));
          assertModelExists(providerDocument, options.model);
          const htmlSnapshot = options.htmlSnapshot
            ? {
                html: await fs.readFile(options.htmlSnapshot, 'utf-8'),
                finalUrl: url,
                pageType: 'chapter' as const,
              }
            : undefined;
          if (htmlSnapshot && options.target !== 'chapter-only') {
            throw new Error('--html-snapshot requires --target chapter-only.');
          }
          if (options.handoff === 'cdp' && options.cdpUrl) {
            this.ui.renderStatus('cdpUrl', options.cdpUrl);
          }
          const job = await this.options.selectorDiscoveryService.create({
            url,
            target: options.target,
            aoBaseUrl: options.aoUrl,
            providerDocument,
            model: options.model,
            forceDiscovery: options.forceDiscovery,
            htmlSnapshot,
          });
          this.ui.renderSuccess(`Discovery job ${job.id} created with status ${job.status}`);
          this.ui.renderStatus('url', job.normalizedUrl);
          this.ui.renderStatus('target', job.target ?? 'full');
          this.ui.renderStatus('handoff', options.handoff ?? 'managed');
          this.ui.renderStatus('model', options.model);
        } catch (error) {
          logger.error({ error: formatError(error) }, 'Failed to create selector discovery job');
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });
  }

  private setupAgentCommand(): void {
    const agentCmd = this.program
      .command('agent')
      .description(agentCliMessages.description);

    agentCmd
      .command('status')
      .description(agentCliMessages.commands.status.description)
      .argument('[adapterId]', agentCliMessages.commands.status.adapterArgument)
      .option('-a, --all', agentCliMessages.commands.status.allOption)
      .action(async (adapterId?: string, options?: { all?: boolean }) => {
        try {
          if (options?.all || !adapterId) {
            const adapterIds = this.options.adapterRegistry.list().map((adapter) => adapter.id);
            const states = await this.options.agentAdminService.listAdapterStates(adapterIds);
            const rows = states.map((state) => [
              state.adapterId,
              state.session?.status ?? '-',
              state.activeVersion?.version ?? '-',
              state.latestCandidate?.version ?? '-',
              String(state.versions?.versions.length ?? 0),
            ]);
            this.ui.renderTable([...agentCliMessages.commands.status.summaryHeaders], rows);
            return;
          }

          const state = await this.options.agentAdminService.getAdapterState(adapterId);
          if (!state.session && !state.activeVersion && !state.latestCandidate && !state.versions) {
            this.ui.renderInfo(agentCliMessages.commands.status.noState);
            return;
          }

          this.ui.renderStatus('adapterId', state.adapterId);
          this.ui.renderStatus('sessionStatus', state.session?.status ?? '-');
          this.ui.renderStatus('activeVersion', state.activeVersion?.version ?? '-');
          this.ui.renderStatus('latestCandidate', state.latestCandidate?.version ?? '-');
          this.ui.renderStatus('versionCount', String(state.versions?.versions.length ?? 0));
        } catch (error) {
          logger.error({ error: formatError(error) }, 'Failed to get agent status');
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });

    agentCmd
      .command('promote')
      .description(agentCliMessages.commands.promote.description)
      .argument('<adapterId>', agentCliMessages.commands.promote.adapterArgument)
      .option('-v, --version <version>', agentCliMessages.commands.promote.versionOption)
      .action(async (adapterId: string, options: { version?: string }) => {
        try {
          const result = await this.options.agentAdminService.promoteCandidate(adapterId, options.version);
          if (!result.success || !result.version) {
            this.ui.renderError(result.error ?? 'Failed to promote candidate version');
            process.exit(1);
          }

          this.ui.renderSuccess(agentCliMessages.commands.promote.success(adapterId, result.version));
        } catch (error) {
          logger.error({ error: formatError(error) }, 'Failed to promote candidate version');
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });

    agentCmd
      .command('reject')
      .description(agentCliMessages.commands.reject.description)
      .argument('<adapterId>', agentCliMessages.commands.reject.adapterArgument)
      .option('-v, --version <version>', agentCliMessages.commands.reject.versionOption)
      .action(async (adapterId: string, options: { version?: string }) => {
        try {
          const result = await this.options.agentAdminService.rejectCandidate(adapterId, options.version);
          if (!result.success || !result.version) {
            this.ui.renderError(result.error ?? 'Failed to reject candidate version');
            process.exit(1);
          }

          this.ui.renderSuccess(agentCliMessages.commands.reject.success(adapterId, result.version));
        } catch (error) {
          logger.error({ error: formatError(error) }, 'Failed to reject candidate version');
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });

    agentCmd
      .command('rollback')
      .description(agentCliMessages.commands.rollback.description)
      .argument('<adapterId>', agentCliMessages.commands.rollback.adapterArgument)
      .option('-v, --version <version>', agentCliMessages.commands.rollback.versionOption)
      .action(async (adapterId: string, options: { version?: string }) => {
        try {
          const result = await this.options.agentAdminService.rollback(adapterId, options.version);
          if (!result.success || !result.currentVersion) {
            this.ui.renderError(result.error ?? 'Failed to rollback adapter');
            process.exit(1);
          }

          this.ui.renderSuccess(agentCliMessages.commands.rollback.success(adapterId, result.currentVersion));
        } catch (error) {
          logger.error({ error: formatError(error) }, 'Failed to rollback adapter');
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });

    agentCmd
      .command('bundle-eval')
      .description('Create a selector-discovery AO job for the bundled Kuronavi evaluation URL')
      .option('--ao-url <url>', 'AO base URL')
      .option('--provider-json <path>', 'Provider JSON file with a top-level provider field')
      .option('--model <model>', 'OpenCode model id in <provider>/<model> format')
      .option('--case <id>', 'Run only one eval case id')
      .option('--repeat <n>', 'Override run count per eval case')
      .option('--live-negative', 'Include disabled live negative cases that may call AO')
      .option('--include-disabled', 'Include all disabled eval cases')
      .option('--min-positive-passes <n>', 'Minimum passing positive eval runs required for release policy')
      .option('--max-positive-failures <n>', 'Maximum failing positive eval runs allowed for release policy', '0')
      .option('--dry-run', 'Print eval suite plan without creating AO discovery jobs')
      .option('--list-cases', 'List eval case inventory without requiring AO/provider/model options')
      .option('--timeout-minutes <minutes>', 'Maximum time to wait for the AO discovery job', '35')
      .option('--poll-interval-ms <ms>', 'Polling interval while waiting for the AO discovery job', '5000')
      .action(async (options: {
        aoUrl: string;
        providerJson: string;
        model: string;
        case?: string;
        repeat?: string;
        liveNegative?: boolean;
        includeDisabled?: boolean;
        minPositivePasses?: string;
        maxPositiveFailures?: string;
        dryRun?: boolean;
        listCases?: boolean;
        timeoutMinutes?: string;
        pollIntervalMs?: string;
      }) => {
        try {
          const cases = await loadSelectorDiscoveryEvalCases({
            caseId: options.case,
            includeDisabled: options.includeDisabled,
            includeLiveNegative: options.liveNegative,
          });
          if (cases.length === 0) {
            throw new Error(options.case ? `Eval case "${options.case}" was not found or is disabled.` : 'No enabled selector-discovery eval cases were found.');
          }

          if (options.listCases) {
            this.renderBundleEvalCaseInventory(cases, {
              includeDisabled: options.includeDisabled,
              liveNegative: options.liveNegative,
            });
            return;
          }

          if (!options.aoUrl?.trim()) throw new Error('--ao-url is required unless --list-cases is used.');
          if (!options.providerJson?.trim()) throw new Error('--provider-json is required unless --list-cases is used.');
          if (!options.model?.trim()) throw new Error('--model is required unless --list-cases is used.');
          if (!this.options.selectorDiscoveryService) {
            this.ui.renderError('Selector discovery service is not available in this CLI context.');
            process.exit(1);
          }
          const providerDocument = validateProviderDocument(JSON.parse(await fs.readFile(options.providerJson, 'utf-8')));
          assertModelExists(providerDocument, options.model);

          const repeatOverride = options.repeat ? Number.parseInt(options.repeat, 10) : undefined;
          if (repeatOverride !== undefined && (!Number.isInteger(repeatOverride) || repeatOverride <= 0)) {
            throw new Error('--repeat must be a positive integer.');
          }

          if (options.dryRun) {
            this.renderBundleEvalDryRun(cases, {
              repeatOverride,
              minPositivePasses: options.minPositivePasses,
              maxPositiveFailures: options.maxPositiveFailures,
              includeDisabled: options.includeDisabled,
              liveNegative: options.liveNegative,
            });
            return;
          }

          const gateResults: SelectorDiscoveryEvalRunResult[] = [];
          for (const evalCase of cases) {
            const runs = repeatOverride ?? evalCase.defaultRuns;
            for (let runIndex = 1; runIndex <= runs; runIndex++) {
              this.ui.renderInfo(`Running eval case ${evalCase.id} (${runIndex}/${runs})`);
              try {
                const job = await this.options.selectorDiscoveryService.create({
                  url: evalCase.url,
                  aoBaseUrl: options.aoUrl,
                  providerDocument,
                  model: options.model,
                  forceDiscovery: true,
                });
                this.ui.renderSuccess(`Bundle evaluation job ${job.id} created with status ${job.status}`);
                this.ui.renderStatus('url', job.normalizedUrl);
                this.ui.renderStatus('model', options.model);
                const completed = await this.waitForSelectorDiscoveryJob(
                  job.id,
                  Number(options.timeoutMinutes ?? '35') * 60_000,
                  Number(options.pollIntervalMs ?? '5000')
                );
                const gateResult = await this.runSelectorDiscoveryEvalGate(completed.id, evalCase);
                gateResults.push({ case: evalCase, runIndex, ...gateResult });
                this.renderBundleEvalResult(gateResult);
              } catch (error) {
                const rejection = error instanceof Error ? error.message : String(error);
                if (evalCase.type !== 'negative') throw error;
                const gateResult = {
                  passed: true,
                  job: undefined,
                  reasons: [],
                  rejection,
                };
                gateResults.push({ case: evalCase, runIndex, ...gateResult });
                this.ui.renderSuccess(`Negative eval case rejected before discovery: ${rejection}`);
              }
            }
          }

          const policy = this.evaluateBundleEvalPolicy(gateResults, {
            minPositivePasses: options.minPositivePasses,
            maxPositiveFailures: options.maxPositiveFailures,
          });
          const artifactPath = await this.writeSelectorDiscoveryBundleEvalSuiteArtifact(gateResults, {
            providerDocument,
            model: options.model,
            aoBaseUrl: options.aoUrl,
            policy,
          });
          this.ui.renderStatus('artifact path', artifactPath);
          const failed = gateResults.filter((result) => !result.passed);
          this.ui.renderStatus('eval cases', String(cases.length));
          this.ui.renderStatus('eval runs', String(gateResults.length));
          this.ui.renderStatus('eval failures', String(failed.length));
          this.renderBundleEvalPolicy(policy);
          if (!policy.passed) {
            process.exit(1);
          }
        } catch (error) {
          logger.error({ error: formatError(error) }, 'Failed to create selector discovery bundle evaluation');
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });

    agentCmd
      .command('bundle-freeze')
      .description('Freeze the selector-discovery draft AO bundle into releases/vN after a passing bundle evaluation')
      .requiredOption('--eval-bundle-hash <hash>', 'Bundle hash directory produced by agent bundle-eval')
      .option('--version <version>', 'Release version such as v1. Defaults to the next vN.')
      .action(async (options: { evalBundleHash: string; version?: string }) => {
        try {
          const evalSummary = await this.readPassingBundleEvalSummary(options.evalBundleHash);
          const bundleManager = new SelectorDiscoveryBundleManager();
          const result = await bundleManager.freezeDraft({
            version: options.version,
            evalBundleHash: options.evalBundleHash,
          });

          this.ui.renderSuccess(`Selector-discovery AO bundle frozen as ${result.release}.`);
          this.ui.renderStatus('release root', result.releaseRoot);
          this.ui.renderStatus('sha256', result.sha256);
          this.ui.renderStatus('active.json', result.activePath);
          this.ui.renderStatus('eval job', String(evalSummary.job?.id ?? '-'));
        } catch (error) {
          logger.error({ error: formatError(error) }, 'Failed to freeze selector discovery bundle');
          if (error instanceof BundleEvalPolicyError) {
            this.renderBundleFreezePolicyError(error);
            process.exit(1);
          }
          this.ui.renderError(formatError(error));
          process.exit(1);
        }
      });
  }

  parse(args: string[]): Command {
    return this.program.parse(args);
  }

  getProgram(): Command {
    return this.program;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }

      return (current as Record<string, unknown>)[key];
    }, obj);
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]!] = value;
    return obj;
  }

  private parseValue(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;

    const numericValue = Number(value);
    if (!Number.isNaN(numericValue)) {
      return numericValue;
    }

    return value;
  }

  private async waitForSelectorDiscoveryJob(id: string, timeoutMs: number, pollIntervalMs: number): Promise<SelectorDiscoveryJob> {
    if (!this.options.selectorDiscoveryService) {
      throw new Error('Selector discovery service is not available in this CLI context.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('--timeout-minutes must be a positive number.');
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new Error('--poll-interval-ms must be a positive number.');
    }

    const startedAt = Date.now();
    let lastStatus = '';
    while (Date.now() - startedAt < timeoutMs) {
      const job = await this.options.selectorDiscoveryService.get(id);
      if (!job) {
        throw new Error(`Discovery job "${id}" was not found.`);
      }
      const statusText = `${job.status}${job.phase ? `/${job.phase}` : ''}`;
      if (statusText !== lastStatus) {
        this.ui.renderStatus('bundle-eval status', statusText);
        lastStatus = statusText;
      }
      if (job.status === 'awaiting_review' || job.status === 'invalid' || job.status === 'failed') {
        return job;
      }
      await sleep(Math.max(250, pollIntervalMs));
    }

    throw new Error(`Timed out waiting for selector discovery job "${id}".`);
  }

  private async runSelectorDiscoveryEvalGate(
    id: string,
    evalCase?: SelectorDiscoveryEvalCase
  ): Promise<{ passed: boolean; job: SelectorDiscoveryJob; reasons: string[] }> {
    if (!this.options.selectorDiscoveryService) {
      throw new Error('Selector discovery service is not available in this CLI context.');
    }

    let job = await this.options.selectorDiscoveryService.get(id);
    if (!job) throw new Error(`Discovery job "${id}" was not found.`);

    if (job.status === 'invalid' && job.candidateMarkdown) {
      job = await this.options.selectorDiscoveryService.revalidate(id);
    }
    if (evalCase?.type === 'negative') {
      if (job.status === 'awaiting_review') {
        return { passed: false, job, reasons: ['Negative eval case unexpectedly produced a reviewable implementation draft.'] };
      }
      return { passed: true, job, reasons: [] };
    }

    if (job.status !== 'awaiting_review') {
      return { passed: false, job, reasons: [`Discovery job ended with status "${job.status}".`] };
    }

    if (job.adapterImplementationTs) {
      const reasons: string[] = [];
      if (!job.implementationValidation?.valid) {
        reasons.push(`Adapter implementation validation failed: ${(job.implementationValidation?.errors ?? []).join('; ') || 'unknown error'}`);
      }
      if (!job.reviewNotesMarkdown?.trim()) {
        reasons.push('Adapter implementation review notes are missing.');
      }
      return { passed: reasons.length === 0, job, reasons };
    }

    job = await this.options.selectorDiscoveryService.validateCandidate(id);
    job = await this.options.selectorDiscoveryService.shadowPromote(id);

    const reasons: string[] = [];
    if (!job.extractionValidation?.valid) {
      reasons.push(`Candidate extraction validation failed: ${(job.extractionValidation?.errors ?? []).join('; ') || 'unknown error'}`);
    }
    if (!job.oracleComparison) {
      reasons.push('No built-in oracle comparison was available.');
    } else {
      if (evalCase?.oracleAdapterId && job.oracleComparison.adapterId !== evalCase.oracleAdapterId) {
        reasons.push(`Oracle adapter was "${job.oracleComparison.adapterId}", expected "${evalCase.oracleAdapterId}".`);
      }
      if (!job.oracleComparison.titleMatched) reasons.push('Candidate title differs from built-in oracle title.');
      if (job.oracleComparison.chapterCountDelta !== 0) reasons.push(`Chapter count delta is ${job.oracleComparison.chapterCountDelta}.`);
      if ((job.oracleComparison.imageCountDelta ?? 0) !== 0) reasons.push(`Image count delta is ${job.oracleComparison.imageCountDelta}.`);
      for (const warning of job.oracleComparison.warnings) reasons.push(warning);
    }

    return { passed: reasons.length === 0, job, reasons };
  }

  private renderBundleEvalResult(result: { passed: boolean; job?: SelectorDiscoveryJob; reasons: string[]; rejection?: string }): void {
    this.ui.renderStatus('bundle-eval job', result.job?.id ?? '-');
    this.ui.renderStatus('candidate status', result.job?.status ?? 'rejected');
    this.ui.renderStatus('extraction validation', result.job?.extractionValidation?.valid ? 'passed' : 'failed');
    if (result.rejection) {
      this.ui.renderStatus('rejection', result.rejection);
    }
    if (result.job?.oracleComparison) {
      this.ui.renderStatus('oracle adapter', `${result.job.oracleComparison.adapterName} (${result.job.oracleComparison.adapterId})`);
      this.ui.renderStatus('title matched', String(result.job.oracleComparison.titleMatched));
      this.ui.renderStatus('chapter count delta', String(result.job.oracleComparison.chapterCountDelta));
      this.ui.renderStatus('image count delta', String(result.job.oracleComparison.imageCountDelta ?? 'n/a'));
    }

    if (result.passed) {
      this.ui.renderSuccess('Bundle evaluation passed.');
      return;
    }

    this.ui.renderError('Bundle evaluation failed.');
    for (const reason of result.reasons) {
      this.ui.renderWarning(reason);
    }
  }

  private renderBundleEvalDryRun(
    cases: SelectorDiscoveryEvalCase[],
    options: {
      repeatOverride?: number;
      minPositivePasses?: string;
      maxPositiveFailures?: string;
      includeDisabled?: boolean;
      liveNegative?: boolean;
    }
  ): void {
    const plannedRuns = cases.flatMap((testCase) =>
      Array.from({ length: options.repeatOverride ?? testCase.defaultRuns }, () => ({
        caseId: testCase.id,
        type: testCase.type,
        passed: true,
      }))
    );
    const policy = evaluateSelectorDiscoveryEvalPolicy({
      minPositivePasses: options.minPositivePasses === undefined
        ? undefined
        : parseNonNegativeInteger(options.minPositivePasses, '--min-positive-passes'),
      maxPositiveFailures: options.maxPositiveFailures === undefined
        ? undefined
        : parseNonNegativeInteger(options.maxPositiveFailures, '--max-positive-failures'),
      runs: plannedRuns,
    });

    this.ui.renderSuccess('Bundle evaluation dry run. No AO discovery jobs were created.');
    this.ui.renderStatus('cases', String(cases.length));
    this.ui.renderStatus('planned runs', String(plannedRuns.length));
    this.ui.renderStatus('include disabled', String(Boolean(options.includeDisabled)));
    this.ui.renderStatus('include live negative', String(Boolean(options.liveNegative)));
    this.ui.renderStatus('policy positive', `${policy.positive.total} planned, min ${policy.positive.minPasses}, max failures ${policy.positive.maxFailures}`);
    this.ui.renderStatus('policy negative', `${policy.negative.total} planned, requires 100%`);
    const rows = cases.map((testCase) => [
      testCase.id,
      testCase.type,
      testCase.enabled ? 'yes' : 'no',
      testCase.live ? 'yes' : 'no',
      String(options.repeatOverride ?? testCase.defaultRuns),
      testCase.url,
    ]);
    this.ui.renderTable(['case', 'type', 'enabled', 'live', 'runs', 'url'], rows);
  }

  private renderBundleEvalCaseInventory(
    cases: SelectorDiscoveryEvalCase[],
    options: { includeDisabled?: boolean; liveNegative?: boolean }
  ): void {
    const positive = cases.filter((testCase) => testCase.type === 'positive');
    const negative = cases.filter((testCase) => testCase.type === 'negative');
    const live = cases.filter((testCase) => testCase.live);
    const disabled = cases.filter((testCase) => !testCase.enabled);
    const plannedRuns = cases.reduce((total, testCase) => total + testCase.defaultRuns, 0);

    this.ui.renderSuccess('Selector-discovery eval case inventory.');
    this.ui.renderStatus('cases', String(cases.length));
    this.ui.renderStatus('positive', String(positive.length));
    this.ui.renderStatus('negative', String(negative.length));
    this.ui.renderStatus('live', String(live.length));
    this.ui.renderStatus('disabled included', String(disabled.length));
    this.ui.renderStatus('default planned runs', String(plannedRuns));
    this.ui.renderStatus('include disabled', String(Boolean(options.includeDisabled)));
    this.ui.renderStatus('include live negative', String(Boolean(options.liveNegative)));
    this.ui.renderTable(
      ['case', 'type', 'enabled', 'live', 'defaultRuns', 'oracle', 'url'],
      cases.map((testCase) => [
        testCase.id,
        testCase.type,
        testCase.enabled ? 'yes' : 'no',
        testCase.live ? 'yes' : 'no',
        String(testCase.defaultRuns),
        testCase.oracleAdapterId ?? '-',
        testCase.url,
      ])
    );
  }

  private evaluateBundleEvalPolicy(
    results: SelectorDiscoveryEvalRunResult[],
    options: { minPositivePasses?: string; maxPositiveFailures?: string }
  ): SelectorDiscoveryEvalPolicyResult {
    const minPositivePasses = options.minPositivePasses === undefined
      ? undefined
      : parseNonNegativeInteger(options.minPositivePasses, '--min-positive-passes');
    const maxPositiveFailures = options.maxPositiveFailures === undefined
      ? undefined
      : parseNonNegativeInteger(options.maxPositiveFailures, '--max-positive-failures');

    return evaluateSelectorDiscoveryEvalPolicy({
      minPositivePasses,
      maxPositiveFailures,
      runs: results.map((result) => ({
        caseId: result.case?.id,
        type: result.case?.type,
        passed: result.passed,
      })),
    });
  }

  private renderBundleEvalPolicy(policy: SelectorDiscoveryEvalPolicyResult): void {
    this.ui.renderStatus('policy positive', `${policy.positive.passed}/${policy.positive.total} passed, min ${policy.positive.minPasses}, max failures ${policy.positive.maxFailures}`);
    this.ui.renderStatus('policy negative', `${policy.negative.passed}/${policy.negative.total} passed, requires 100%`);
    if (policy.passed) {
      this.ui.renderSuccess('Bundle evaluation release policy passed.');
      return;
    }

    this.ui.renderError('Bundle evaluation release policy failed.');
    for (const reason of policy.reasons) {
      this.ui.renderWarning(reason);
    }
  }

  private renderBundleFreezePolicyError(error: BundleEvalPolicyError): void {
    this.ui.renderError(error.message);
    this.ui.renderStatus('summary path', error.summaryPath);
    const policy = error.summary?.policy;
    if (policy) {
      this.ui.renderStatus('policy positive', `${policy.positive?.passed ?? 0}/${policy.positive?.total ?? 0} passed, min ${policy.positive?.minPasses ?? '-'}`);
      this.ui.renderStatus('policy negative', `${policy.negative?.passed ?? 0}/${policy.negative?.total ?? 0} passed, requires 100%`);
      for (const reason of Array.isArray(policy.reasons) ? policy.reasons : []) {
        this.ui.renderWarning(`policy: ${reason}`);
      }
    }

    const failedRuns = summarizeFailedEvalRuns(error.summary);
    for (const failedRun of failedRuns.slice(0, 10)) {
      this.ui.renderWarning(failedRun);
    }
    if (failedRuns.length > 10) {
      this.ui.renderWarning(`...and ${failedRuns.length - 10} more failed runs.`);
    }
  }

  private async writeSelectorDiscoveryBundleEvalArtifact(
    result: { passed: boolean; job?: SelectorDiscoveryJob; reasons: string[]; rejection?: string },
    input: { providerDocument: ProviderDocument; model: string; aoBaseUrl: string }
  ): Promise<string> {
    const results = [{ case: undefined, runIndex: 1, ...result }];
    return this.writeSelectorDiscoveryBundleEvalSuiteArtifact(results, {
      ...input,
      policy: this.evaluateBundleEvalPolicy(results, {}),
    });
  }

  private async writeSelectorDiscoveryBundleEvalSuiteArtifact(
    results: SelectorDiscoveryEvalRunResult[],
    input: { providerDocument: ProviderDocument; model: string; aoBaseUrl: string; policy: SelectorDiscoveryEvalPolicyResult }
  ): Promise<string> {
    const bundleManager = new SelectorDiscoveryBundleManager();
    const bundle = await bundleManager.loadActive(input.providerDocument, input.model);
    const workspaceRoot = resolveRuntimeConfig().agentWorkspacePath;
    const artifactDir = join(workspaceRoot, 'bundle-evaluations', bundle.hash);
    await fs.mkdir(artifactDir, { recursive: true });
    const reasons = results.flatMap((result) =>
      result.reasons.map((reason) => `${result.case?.id ?? 'default'} run ${result.runIndex}: ${reason}`)
    );
    const policyReasons = input.policy.reasons.map((reason) => `policy: ${reason}`);

    const summary = {
      schemaVersion: 1,
      kind: 'selector-discovery-bundle-evaluation',
      passed: input.policy.passed,
      reasons: [...reasons, ...policyReasons],
      policy: input.policy,
      createdAt: new Date().toISOString(),
      bundle: {
        hash: bundle.hash,
        root: bundle.root,
      },
      runtime: {
        aoBaseUrl: input.aoBaseUrl,
        model: input.model,
        providerFingerprint: fingerprintProviderDocument(input.providerDocument),
      },
      cases: results.map((result) => this.createEvalCaseSummary(result)),
      job: this.createEvalJobSummary(findLastJob(results)),
    };

    await fs.writeFile(join(artifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
    for (const result of results) {
      const caseId = result.case?.id ?? 'default';
      const runDir = join(artifactDir, 'cases', safePathSegment(caseId), `run-${result.runIndex}`);
      await fs.mkdir(runDir, { recursive: true });
      await fs.writeFile(join(runDir, 'summary.json'), `${JSON.stringify(this.createEvalCaseSummary(result), null, 2)}\n`, 'utf-8');
      await fs.writeFile(join(runDir, 'phase1-output.md'), result.job?.phase1Markdown ?? '', 'utf-8');
      await fs.writeFile(join(runDir, 'adapter-implementation.ts'), result.job?.adapterImplementationTs ?? '', 'utf-8');
      await fs.writeFile(join(runDir, 'review-notes.md'), result.job?.reviewNotesMarkdown ?? '', 'utf-8');
      await fs.writeFile(join(runDir, 'legacy-candidate-output.md'), result.job?.candidateMarkdown ?? '', 'utf-8');
      await fs.writeFile(join(runDir, 'parsed-candidate.json'), `${JSON.stringify(result.job?.parsedCandidate ?? null, null, 2)}\n`, 'utf-8');
      await fs.writeFile(join(runDir, 'implementation-validation.json'), `${JSON.stringify(result.job?.implementationValidation ?? null, null, 2)}\n`, 'utf-8');
      await fs.writeFile(join(runDir, 'oracle-comparison.json'), `${JSON.stringify(result.job?.oracleComparison ?? null, null, 2)}\n`, 'utf-8');
    }

    const last = findLastJob(results);
    await fs.writeFile(join(artifactDir, 'phase1-output.md'), last?.phase1Markdown ?? '', 'utf-8');
    await fs.writeFile(join(artifactDir, 'adapter-implementation.ts'), last?.adapterImplementationTs ?? '', 'utf-8');
    await fs.writeFile(join(artifactDir, 'review-notes.md'), last?.reviewNotesMarkdown ?? '', 'utf-8');
    await fs.writeFile(join(artifactDir, 'legacy-candidate-output.md'), last?.candidateMarkdown ?? '', 'utf-8');
    await fs.writeFile(join(artifactDir, 'parsed-candidate.json'), `${JSON.stringify(last?.parsedCandidate ?? null, null, 2)}\n`, 'utf-8');
    await fs.writeFile(join(artifactDir, 'implementation-validation.json'), `${JSON.stringify(last?.implementationValidation ?? null, null, 2)}\n`, 'utf-8');
    await fs.writeFile(join(artifactDir, 'oracle-comparison.json'), `${JSON.stringify(last?.oracleComparison ?? null, null, 2)}\n`, 'utf-8');

    return artifactDir;
  }

  private createEvalCaseSummary(result: SelectorDiscoveryEvalRunResult): Record<string, unknown> {
    return {
      case: result.case ? {
        id: result.case.id,
        type: result.case.type,
        enabled: result.case.enabled,
        live: result.case.live,
        url: result.case.url,
        oracleAdapterId: result.case.oracleAdapterId,
        expectations: result.case.expectations,
      } : undefined,
      runIndex: result.runIndex,
      passed: result.passed,
      reasons: result.reasons,
      rejection: result.rejection,
      job: this.createEvalJobSummary(result.job),
    };
  }

  private createEvalJobSummary(job?: SelectorDiscoveryJob): Record<string, unknown> | undefined {
    if (!job) return undefined;
    return {
      id: job.id,
      url: job.normalizedUrl,
      hostname: job.hostname,
      status: job.status,
      phase: job.phase,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      validation: job.validation,
      implementationValidation: job.implementationValidation,
      extractionValidation: job.extractionValidation,
      shadowPromotion: job.shadowPromotion,
      oracleComparison: job.oracleComparison,
      error: job.error,
    };
  }

  private async readPassingBundleEvalSummary(evalBundleHash: string): Promise<any> {
    if (!/^[a-f0-9]{64}$/i.test(evalBundleHash)) {
      throw new Error('--eval-bundle-hash must be a 64-character SHA-256 hex string.');
    }

    const workspaceRoot = resolveRuntimeConfig().agentWorkspacePath;
    const summaryPath = join(workspaceRoot, 'bundle-evaluations', evalBundleHash, 'summary.json');
    let summary: any;
    try {
      summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
    } catch {
      throw new Error(`Bundle evaluation summary was not found at ${summaryPath}.`);
    }

    if (summary?.kind !== 'selector-discovery-bundle-evaluation') {
      throw new Error(`Bundle evaluation summary at ${summaryPath} has an unexpected kind.`);
    }
    if (summary?.bundle?.hash !== evalBundleHash) {
      throw new Error(`Bundle evaluation summary hash does not match ${evalBundleHash}.`);
    }
    if (summary?.passed !== true) {
      throw new BundleEvalPolicyError(`Bundle evaluation ${evalBundleHash} has not passed.`, summaryPath, summary);
    }
    if (summary?.policy?.passed !== true) {
      throw new BundleEvalPolicyError(`Bundle evaluation ${evalBundleHash} did not pass release policy.`, summaryPath, summary);
    }

    return summary;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'case';
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function findLastJob(results: SelectorDiscoveryEvalRunResult[]): SelectorDiscoveryJob | undefined {
  for (let index = results.length - 1; index >= 0; index--) {
    const job = results[index]?.job;
    if (job) return job;
  }
  return undefined;
}

function summarizeFailedEvalRuns(summary: any): string[] {
  const cases = Array.isArray(summary?.cases) ? summary.cases : [];
  return cases
    .filter((item: any) => item?.passed !== true)
    .map((item: any) => {
      const caseId = item?.case?.id ?? 'unknown-case';
      const runIndex = item?.runIndex ?? '?';
      const reasons = Array.isArray(item?.reasons) && item.reasons.length > 0
        ? item.reasons.join('; ')
        : item?.rejection
          ? `rejection: ${item.rejection}`
          : `job status: ${item?.job?.status ?? 'unknown'}`;
      return `${caseId} run ${runIndex}: ${reasons}`;
    });
}
