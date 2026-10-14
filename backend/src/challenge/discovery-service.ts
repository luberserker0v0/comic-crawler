import type { Browser, BrowserContext } from 'playwright';
import type { BrowserConfig, NetworkConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import { fetchSafeHtml, normalizeAndValidateUrl } from '../selector-discovery/safe-fetch';
import { looksLikeAccessBlocked, looksLikeAntiBotChallenge } from '../crawler/anti-bot';
import { BrowserChallengeHandler } from './browser-challenge-handler';
import { getGlobalChallengeStrategyRegistry } from './registry';
import { getGlobalVerifiedBrowserSessionRegistry, type VerifiedBrowserSession } from './verified-browser-sessions';
import { loadChallengeStrategyFromSource } from './strategy-loader';
import { validateChallengeStrategySource } from './strategy-validator';
import type { ChallengeDiscoveryJob } from './discovery-types';
import { findPageHtmlInContexts, inspectRemoteBrowser, type RemoteConnectionSummary } from './remote-handoff';
import { connectRemoteBrowser, requireRemoteBrowserEndpoint } from '../browser/remote-browser-provider';

const JOB_PREFIX = 'challenge-discovery-job-';
const INDEX_KEY = 'challenge-discovery-index';
const ACTIVE_STRATEGIES_KEY = 'challenge-discovery-active-strategies';

export interface ChallengeDiscoveryServiceOptions {
  workspaceRoot?: string;
  getBrowserConfig?: () => BrowserConfig | Promise<BrowserConfig>;
  getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
}

export class ChallengeDiscoveryService {
  private readonly browserContexts = new Map<string, {
    browser: Browser;
    context: BrowserContext;
    wsEndpoint: string;
  }>();

  constructor(
    private readonly storage: IStorage,
    private readonly options: ChallengeDiscoveryServiceOptions = {}
  ) {}

  async create(input: { url: string }): Promise<ChallengeDiscoveryJob> {
    const job = await this.createQueuedJob(input);
    return this.run(job.id);
  }

  async createDeferred(input: { url: string }): Promise<ChallengeDiscoveryJob> {
    const job = await this.createQueuedJob(input);
    void this.run(job.id).catch(async (error) => {
      await this.updateJob(job.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    });
    return job;
  }

  private async createQueuedJob(input: { url: string }): Promise<ChallengeDiscoveryJob> {
    const normalizedUrl = normalizeAndValidateUrl(input.url);
    const hostname = new URL(normalizedUrl).hostname;
    const now = new Date().toISOString();
    const job: ChallengeDiscoveryJob = {
      id: this.createJobId(),
      url: input.url,
      normalizedUrl,
      hostname,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    await this.saveJob(job);
    return job;
  }

  async probe(url: string): Promise<{ status: 'ready' | 'challenge' | 'failed'; job?: ChallengeDiscoveryJob; error?: string }> {
    try {
      await this.renderReady(url);
      return { status: 'ready' };
    } catch (error) {
      if (isAntiBotChallengeError(error)) {
        return { status: 'challenge', job: await this.create({ url }) };
      }
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async retry(id: string): Promise<ChallengeDiscoveryJob> {
    return this.run(id);
  }

  async promote(id: string): Promise<{ strategyId: string; domains: string[] }> {
    const job = await this.getRequiredJob(id);
    if (!job.candidateSource) {
      throw new Error('Challenge discovery job has no strategy candidate.');
    }
    const sourceValidation = validateChallengeStrategySource(job.candidateSource);
    if (!sourceValidation.valid) {
      await this.updateJob(id, { validation: sourceValidation, status: 'failed', error: sourceValidation.errors.join(' ') });
      throw new Error(sourceValidation.errors.join(' '));
    }
    const strategy = loadChallengeStrategyFromSource(job.candidateSource);
    const registry = getGlobalChallengeStrategyRegistry();
    if (!registry.get(strategy.id)) {
      registry.register(strategy);
    }
    const active = (await this.storage.read<Array<{ strategyId: string; source: string; promotedAt: string }>>(ACTIVE_STRATEGIES_KEY)) ?? [];
    await this.storage.write(ACTIVE_STRATEGIES_KEY, [
      ...active.filter((entry) => entry.strategyId !== strategy.id),
      { strategyId: strategy.id, source: job.candidateSource, promotedAt: new Date().toISOString() },
    ]);
    await this.updateJob(id, { status: 'strategy_promoted', strategyId: strategy.id, validation: sourceValidation });
    return { strategyId: strategy.id, domains: strategy.domains };
  }

  async loadActiveStrategies(): Promise<void> {
    const active = (await this.storage.read<Array<{ strategyId: string; source: string }>>(ACTIVE_STRATEGIES_KEY)) ?? [];
    const registry = getGlobalChallengeStrategyRegistry();
    for (const entry of active) {
      const strategy = loadChallengeStrategyFromSource(entry.source);
      if (!registry.get(strategy.id)) {
        registry.register(strategy);
      }
    }
  }

  async openBrowser(id: string): Promise<ChallengeDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    getGlobalVerifiedBrowserSessionRegistry().deleteBySourceJobId(job.id);
    const existing = this.browserContexts.get(job.id);
    if (existing) {
      await existing.context.close().catch(() => undefined);
      await existing.browser.close().catch(() => undefined);
      this.browserContexts.delete(job.id);
    }
    const browserConfig = await this.getBrowserConfig();
    const network = await this.getNetworkConfig();
    const wsEndpoint = requireRemoteBrowserEndpoint({
      wsEndpoint: browserConfig.remote?.wsEndpoint,
    });
    const browser = await connectRemoteBrowser({
      wsEndpoint,
      timeout: browserConfig.remote?.connectTimeout ?? browserConfig.timeout,
      exposeNetwork: browserConfig.remote?.exposeNetwork,
      headers: browserConfig.remote?.headers,
    });
    const context = await browser.newContext({
      userAgent: network?.userAgent,
      proxy: network?.proxy ? { server: network.proxy } : undefined,
      viewport: { width: 1920, height: 1080 },
      storageState: browserConfig.storageStatePath,
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(job.normalizedUrl, {
      waitUntil: browserConfig.waitUntil ?? 'domcontentloaded',
      timeout: browserConfig.timeout ?? 30000,
    }).catch(() => undefined);
    this.browserContexts.set(job.id, { browser, context, wsEndpoint });
    await this.updateJob(job.id, {
      status: 'browser_open',
      error: undefined,
    });
    return this.getRequiredJob(job.id);
  }

  async testRemoteConnection(wsEndpoint?: string): Promise<RemoteConnectionSummary> {
    const resolved = wsEndpoint ?? (await this.getBrowserConfig()).remote?.wsEndpoint;
    if (!resolved) {
      throw new Error('No active Browser Provider session is available.');
    }
    return inspectRemoteBrowser(resolved);
  }

  async inspectRemotePage(id: string): Promise<ChallengeDiscoveryJob> {
    await this.readRemotePageSnapshot(id);
    return this.getRequiredJob(id);
  }

  async readRemotePageSnapshot(id: string, options: { settle?: boolean; allowNavigate?: boolean } = {}): Promise<{
    job: ChallengeDiscoveryJob;
    page: { url: string; title: string; html: string };
  }> {
    const job = await this.getRequiredJob(id);
    const activeSession = this.browserContexts.get(id);
    if (!activeSession) {
      throw new Error('The remote browser context is no longer active. Open the browser from this handoff first.');
    }
    const page = await findPageHtmlInContexts([activeSession.context], {
      targetUrl: job.normalizedUrl,
      settle: options.settle,
      allowNavigate: options.allowNavigate,
    });
    if (looksLikeAccessBlocked(page.html)) {
      const message = `Attached browser page is blocked: ${page.title || page.url}`;
      await this.updateJob(id, {
        status: 'access_blocked',
        error: message,
      });
      throw new Error(message);
    }
    if (looksLikeAntiBotChallenge(page.html)) {
      const message = `Attached browser page still shows a challenge: ${page.title || page.url}`;
      await this.updateJob(id, {
        status: 'challenge_required',
        error: message,
      });
      throw new Error(message);
    }
    await this.updateJob(id, {
      status: 'ready',
      error: undefined,
      diagnosisMarkdown: `# Challenge Diagnosis

## Status

- Status: ready
- Source: remote Playwright browser session
- Page URL: ${page.url}
- Page Title: ${page.title}
`,
    });
    return { job: await this.getRequiredJob(id), page };
  }

  async completeHumanVerification(id: string, _options: { settle?: boolean; allowNavigate?: boolean } = {}): Promise<ChallengeDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    const remoteSession = this.browserContexts.get(id);
    if (remoteSession) {
      const page = remoteSession.context.pages()[0];
      if (page) {
        const html = await page.content().catch(() => '');
        if (looksLikeAccessBlocked(html)) {
          await this.updateJob(id, {
            status: 'access_blocked',
            error: 'Human verification reached an explicit access blocked page for this browser/session.',
          });
          return this.getRequiredJob(id);
        }
        if (looksLikeAntiBotChallenge(html)) {
          await this.updateJob(id, {
            status: 'challenge_required',
            error: 'Human verification is not complete yet. The headed browser is still showing a challenge page.',
          });
          return this.getRequiredJob(id);
        }

        const ready = await new BrowserChallengeHandler()
          .ensureReady(page, job.normalizedUrl, { challengeAutoAttempt: false })
          .catch((error) => {
            if (isAccessBlockedError(error)) return 'access_blocked' as const;
            if (isAntiBotChallengeError(error)) return null;
            throw error;
          });
        if (ready === 'access_blocked') {
          await this.updateJob(id, {
            status: 'access_blocked',
            error: 'Human verification reached an explicit access blocked page for this browser/session.',
          });
          return this.getRequiredJob(id);
        }
        if (!ready) {
          await this.updateJob(id, {
            status: 'challenge_required',
            error: 'Human verification did not reach a parser-ready page yet.',
          });
          return this.getRequiredJob(id);
        }
      }
      await this.registerVerifiedSession({
        hostname: job.hostname,
        wsEndpoint: remoteSession.wsEndpoint,
        context: remoteSession.context,
        sourceJobId: job.id,
        verifiedAt: new Date().toISOString(),
      });
      await this.updateJob(id, {
        status: 'ready',
        error: undefined,
        diagnosisMarkdown: '# Challenge Diagnosis\n\n## Status\n\n- Status: ready\n- Remote browser verification session is available for this hostname.\n',
      });
      return this.getRequiredJob(id);
    }

    await this.updateJob(id, {
      status: 'challenge_required',
      error: 'The remote browser context is no longer active. Reopen the verification browser from this handoff.',
    });
    return this.getRequiredJob(id);
  }

  async get(id: string): Promise<ChallengeDiscoveryJob | null> {
    return this.storage.read<ChallengeDiscoveryJob>(`${JOB_PREFIX}${id}`);
  }

  async deleteJob(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    const ids = (await this.storage.read<string[]>(INDEX_KEY)) ?? [];
    await this.storage.write(INDEX_KEY, ids.filter((entry) => entry !== id));
    await this.storage.delete(`${JOB_PREFIX}${id}`);
    const remoteSession = this.browserContexts.get(id);
    if (remoteSession) {
      await remoteSession.context.close().catch(() => undefined);
      await remoteSession.browser.close().catch(() => undefined);
      this.browserContexts.delete(id);
    }
    getGlobalVerifiedBrowserSessionRegistry().deleteBySourceJobId(id);
    return true;
  }

  async list(): Promise<ChallengeDiscoveryJob[]> {
    const ids = (await this.storage.read<string[]>(INDEX_KEY)) ?? [];
    const jobs = await Promise.all(ids.map((id) => this.get(id)));
    return jobs.filter((job): job is ChallengeDiscoveryJob => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async run(id: string): Promise<ChallengeDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    try {
      await this.updateJob(id, { status: 'challenge_detected', error: undefined });
      await this.renderReady(job.normalizedUrl);
      await this.updateJob(id, {
        status: 'ready',
        diagnosisMarkdown: '# Challenge Diagnosis\n\n## Status\n\n- Status: ready\n',
      });
      return this.getRequiredJob(id);
    } catch (error) {
      if (!isAntiBotChallengeError(error)) {
        await this.updateJob(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
        return this.getRequiredJob(id);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.updateJob(id, {
        status: isAccessBlockedError(error) ? 'access_blocked' : 'challenge_required',
        diagnosisMarkdown: [
          '# Challenge Diagnosis',
          '',
          '## Status',
          '',
          `- Status: ${isAccessBlockedError(error) ? 'access_blocked' : 'challenge_required'}`,
          `- URL: ${job.normalizedUrl}`,
          '- Next step: use the human verification handoff flow.',
          '',
        ].join('\n'),
        evidenceMarkdown: [
          '# Browser Render Evidence',
          '',
          '## Source URL',
          '',
          job.normalizedUrl,
          '',
          '## Render Result',
          '',
          `- Error: ${message}`,
          '',
        ].join('\n'),
        candidateSource: undefined,
        validation: undefined,
        error: message,
      });
      return this.getRequiredJob(id);
    }
  }

  private async renderReady(url: string, browserPatch: Partial<BrowserConfig> = {}): Promise<void> {
    const [browser, network] = await Promise.all([this.getBrowserConfig(), this.getNetworkConfig()]);
    await fetchSafeHtml(url, { browser: { ...browser, ...browserPatch }, network });
  }

  private async registerVerifiedSession(session: VerifiedBrowserSession): Promise<void> {
    getGlobalVerifiedBrowserSessionRegistry().register(session);
  }

  private async getBrowserConfig(): Promise<BrowserConfig> {
    return this.options.getBrowserConfig
      ? await this.options.getBrowserConfig()
      : {
          mode: 'remote',
          maxInstances: 1,
          timeout: 30000,
          waitUntil: 'domcontentloaded',
          challengeAutoAttempt: true,
          challengeWaitMs: 15000,
        };
  }

  private async getNetworkConfig(): Promise<NetworkConfig | undefined> {
    return this.options.getNetworkConfig ? await this.options.getNetworkConfig() : undefined;
  }

  private async getRequiredJob(id: string): Promise<ChallengeDiscoveryJob> {
    const job = await this.get(id);
    if (!job) throw new Error(`Challenge discovery job "${id}" was not found.`);
    return job;
  }

  private async updateJob(id: string, patch: Partial<ChallengeDiscoveryJob>): Promise<void> {
    const job = await this.getRequiredJob(id);
    await this.saveJob({ ...job, ...patch, updatedAt: new Date().toISOString() });
  }

  private async saveJob(job: ChallengeDiscoveryJob): Promise<void> {
    await this.storage.write(`${JOB_PREFIX}${job.id}`, job);
    const ids = (await this.storage.read<string[]>(INDEX_KEY)) ?? [];
    if (!ids.includes(job.id)) {
      ids.unshift(job.id);
      await this.storage.write(INDEX_KEY, ids.slice(0, 200));
    }
  }

  private createJobId(): string {
    return `chal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function isAntiBotChallengeError(error: unknown): boolean {
  if (typeof error === 'object' && error && 'context' in error) {
    const context = (error as { context?: Record<string, unknown> }).context;
    if (context?.antiBotChallenge === true) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /anti-bot|challenge|cloudflare|access_blocked|sorry, you have been blocked|unable to access/i.test(message);
}

function isAccessBlockedError(error: unknown): boolean {
  if (typeof error === 'object' && error && 'context' in error) {
    const context = (error as { context?: Record<string, unknown> }).context;
    const decision = context?.decision as { challengeType?: unknown } | undefined;
    if (decision?.challengeType === 'access_blocked') return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /access_blocked|sorry, you have been blocked|unable to access/i.test(message);
}
