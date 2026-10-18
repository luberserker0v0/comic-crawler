import * as cheerio from 'cheerio';
import type { BrowserConfig, BrowserTarget, NetworkConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import { fetchSafeHtml, normalizeAndValidateUrl } from '../selector-discovery/safe-fetch';
import { looksLikeAccessBlocked, looksLikeAntiBotChallenge } from '../crawler/anti-bot';
import { getGlobalChallengeStrategyRegistry } from './registry';
import { loadChallengeStrategyFromSource } from './strategy-loader';
import { validateChallengeStrategySource } from './strategy-validator';
import type { ChallengeDiscoveryJob } from './discovery-types';
import type { BrowserRenderService } from '../browser/browser-render-service';

const JOB_PREFIX = 'challenge-discovery-job-';
const INDEX_KEY = 'challenge-discovery-index';
const ACTIVE_STRATEGIES_KEY = 'challenge-discovery-active-strategies';

export interface ChallengeDiscoveryServiceOptions {
  workspaceRoot?: string;
  getBrowserConfig?: (browserSessionId?: string) => BrowserConfig | Promise<BrowserConfig>;
  getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
  acquireBrowserSession?: (input: { jobId: string; ownerUserId: string; url: string; browserTarget?: BrowserTarget }) => Promise<{ sessionId: string; release(): Promise<void> }>;
  browserRenderService?: BrowserRenderService;
}

interface TransferredBrowserLease {
  sessionId: string;
  release(): Promise<void>;
}

type ChallengeDiscoveryInput = {
  url: string;
  browserSessionId?: string;
  browserLease?: TransferredBrowserLease;
  ownerUserId?: string;
  browserTarget?: BrowserTarget;
};

export class ChallengeDiscoveryService {
  private readonly ownedBrowserLeases = new Map<string, { release(): Promise<void> }>();
  constructor(
    private readonly storage: IStorage,
    private readonly options: ChallengeDiscoveryServiceOptions = {}
  ) {}

  async create(input: ChallengeDiscoveryInput): Promise<ChallengeDiscoveryJob> {
    const job = await this.createQueuedJob(input);
    const result = await this.run(job.id);
    if (result.status === 'failed') await this.releaseBrowserLease(job.id);
    return result;
  }

  async createDeferred(input: ChallengeDiscoveryInput): Promise<ChallengeDiscoveryJob> {
    const job = await this.createQueuedJob(input);
    void this.run(job.id).then(async (result) => {
      if (result.status === 'failed') {
        await this.releaseBrowserLease(job.id);
      }
    }).catch(async (error) => {
      await this.updateJob(job.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      await this.releaseBrowserLease(job.id).catch(() => undefined);
    });
    return job;
  }

  private async createQueuedJob(input: ChallengeDiscoveryInput): Promise<ChallengeDiscoveryJob> {
    const normalizedUrl = normalizeAndValidateUrl(input.url);
    const hostname = new URL(normalizedUrl).hostname;
    const now = new Date().toISOString();
    const job: ChallengeDiscoveryJob = {
      id: this.createJobId(),
      url: input.url,
      normalizedUrl,
      hostname,
      status: 'queued',
      browserSessionId: input.browserLease?.sessionId ?? input.browserSessionId,
      ownerUserId: input.ownerUserId,
      browserTarget: input.browserTarget,
      createdAt: now,
      updatedAt: now,
    };
    await this.saveJob(job);
    if (input.browserLease) this.ownedBrowserLeases.set(job.id, input.browserLease);
    return job;
  }

  async probe(url: string, input: { ownerUserId?: string; browserTarget?: BrowserTarget } = {}): Promise<{ status: 'ready' | 'challenge' | 'failed'; job?: ChallengeDiscoveryJob; error?: string }> {
    const job = await this.create({ url, ...input });
    if (job.status === 'ready') {
      await this.releaseBrowserLease(job.id);
      return { status: 'ready' };
    }
    if (['challenge_detected', 'challenge_required', 'access_blocked'].includes(job.status)) {
      return { status: 'challenge', job };
    }
    return { status: 'failed', job, error: job.error };
  }

  async releaseBrowserLease(id: string): Promise<void> {
    const lease = this.ownedBrowserLeases.get(id);
    if (!lease) return;
    this.ownedBrowserLeases.delete(id);
    await lease.release();
    await this.updateJob(id, { browserSessionId: undefined }).catch(() => undefined);
  }

  detachBrowserLease(id: string): void {
    this.ownedBrowserLeases.delete(id);
  }

  async rebindBrowserTarget(id: string, browserTarget: BrowserTarget): Promise<ChallengeDiscoveryJob> {
    await this.releaseBrowserLease(id);
    await this.updateJob(id, {
      browserTarget,
      browserSessionId: undefined,
      status: 'queued',
      error: undefined,
    });
    try {
      const result = await this.run(id);
      if (result.status === 'failed') await this.releaseBrowserLease(id);
      return result;
    } catch (error) {
      await this.updateJob(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      await this.releaseBrowserLease(id);
      return this.getRequiredJob(id);
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.ownedBrowserLeases.keys()].map((id) => this.releaseBrowserLease(id)));
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
    const job = await this.ensureBrowserSession(await this.getRequiredJob(id));
    const renderService = this.requireBrowserRenderService();
    const sessionId = requireSessionId(job);
    await renderService.focus(sessionId);
    await this.updateJob(job.id, {
      status: 'browser_open',
      error: undefined,
    });
    return this.getRequiredJob(job.id);
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
    const sessionId = requireSessionId(job);
    const renderService = this.requireBrowserRenderService();
    let page = await renderService.snapshot(sessionId);
    if (options.allowNavigate && !samePage(page.url, job.normalizedUrl)) {
      await renderService.navigate(sessionId, job.normalizedUrl);
      page = await renderService.snapshot(sessionId);
    }
    if (options.settle) {
      const browser = await this.getBrowserConfig(sessionId);
      page = await renderService.render(sessionId, page.url, {
        timeoutMs: browser.timeout,
        postLoadDelayMs: browser.postLoadDelayMs,
      });
    }
    const title = cheerio.load(page.html)('title').first().text().trim();
    if (looksLikeAccessBlocked(page.html)) {
      const message = `Attached browser page is blocked: ${title || page.url}`;
      await this.updateJob(id, {
        status: 'access_blocked',
        error: message,
      });
      throw new Error(message);
    }
    if (looksLikeAntiBotChallenge(page.html)) {
      const message = `Attached browser page still shows a challenge: ${title || page.url}`;
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
- Source: Browser Worker session
- Page URL: ${page.url}
- Page Title: ${title}
`,
    });
    return { job: await this.getRequiredJob(id), page: { ...page, title } };
  }

  async completeHumanVerification(id: string, _options: { settle?: boolean; allowNavigate?: boolean } = {}): Promise<ChallengeDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    const page = await this.requireBrowserRenderService().snapshot(requireSessionId(job));
    if (looksLikeAccessBlocked(page.html)) {
      await this.updateJob(id, {
        status: 'access_blocked',
        error: 'Human verification reached an explicit access blocked page for this browser/session.',
      });
      return this.getRequiredJob(id);
    }
    if (looksLikeAntiBotChallenge(page.html)) {
      await this.updateJob(id, {
        status: 'challenge_required',
        error: 'Human verification is not complete yet. The browser still shows a challenge page.',
      });
      return this.getRequiredJob(id);
    }
    await this.updateJob(id, {
      status: 'ready',
      error: undefined,
      diagnosisMarkdown: '# Challenge Diagnosis\n\n## Status\n\n- Status: ready\n- Browser Worker session passed human verification.\n',
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
    await this.releaseBrowserLease(id);
    return true;
  }

  async list(): Promise<ChallengeDiscoveryJob[]> {
    const ids = (await this.storage.read<string[]>(INDEX_KEY)) ?? [];
    const jobs = await Promise.all(ids.map((id) => this.get(id)));
    return jobs.filter((job): job is ChallengeDiscoveryJob => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async run(id: string): Promise<ChallengeDiscoveryJob> {
    const job = await this.ensureBrowserSession(await this.getRequiredJob(id));
    try {
      await this.updateJob(id, { status: 'challenge_detected', error: undefined });
      await this.renderReady(job.normalizedUrl, {}, job.browserSessionId);
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

  private async renderReady(url: string, browserPatch: Partial<BrowserConfig> = {}, browserSessionId?: string): Promise<void> {
    const [browser, network] = await Promise.all([this.getBrowserConfig(browserSessionId), this.getNetworkConfig()]);
    await fetchSafeHtml(url, {
      browser: { ...browser, ...browserPatch },
      network,
      renderFirst: true,
      ...(browserSessionId && this.options.browserRenderService
        ? { renderPage: (renderUrl: string, input: { timeoutMs: number }) =>
            this.options.browserRenderService!.render(browserSessionId, renderUrl, input) }
        : {}),
    });
  }

  private async getBrowserConfig(browserSessionId?: string): Promise<BrowserConfig> {
    return this.options.getBrowserConfig
      ? await this.options.getBrowserConfig(browserSessionId)
      : {
          timeout: 30000,
          workerWaitTimeoutMs: 30 * 60 * 1000,
          postLoadDelayMs: 0,
        };
  }

  private async ensureBrowserSession(job: ChallengeDiscoveryJob): Promise<ChallengeDiscoveryJob> {
    if (job.browserSessionId || !this.options.acquireBrowserSession) return job;
    const lease = await this.options.acquireBrowserSession({
      jobId: job.id,
      ownerUserId: job.ownerUserId ?? 'public',
      url: job.normalizedUrl,
      browserTarget: job.browserTarget,
    });
    this.ownedBrowserLeases.set(job.id, lease);
    await this.updateJob(job.id, { browserSessionId: lease.sessionId });
    return this.getRequiredJob(job.id);
  }

  private async getNetworkConfig(): Promise<NetworkConfig | undefined> {
    return this.options.getNetworkConfig ? await this.options.getNetworkConfig() : undefined;
  }

  private requireBrowserRenderService(): BrowserRenderService {
    if (!this.options.browserRenderService) {
      throw new Error('Browser Worker render service is not configured.');
    }
    return this.options.browserRenderService;
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

function requireSessionId(job: ChallengeDiscoveryJob): string {
  if (!job.browserSessionId) throw new Error('Browser Worker session is not available for this handoff.');
  return job.browserSessionId;
}

function samePage(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.hostname === rightUrl.hostname
      && leftUrl.pathname.replace(/\/+$/, '') === rightUrl.pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
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
