import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { chromium, type BrowserContext } from 'playwright';
import type { BrowserConfig, NetworkConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import { fetchSafeHtml, normalizeAndValidateUrl } from '../selector-discovery/safe-fetch';
import { looksLikeAccessBlocked, looksLikeAntiBotChallenge } from '../crawler/anti-bot';
import { BrowserChallengeHandler } from './browser-challenge-handler';
import { getGlobalChallengeStrategyRegistry } from './registry';
import { getGlobalVerifiedBrowserSessionRegistry, type VerifiedBrowserSession } from './verified-browser-sessions';
import { loadChallengeStrategyFromSource } from './strategy-loader';
import { validateChallengeStrategySource } from './strategy-validator';
import { runSelfAoChallengeDiscovery } from './self-ao';
import type { ChallengeDiscoveryJob } from './discovery-types';
import { findCdpPageHtml, inspectCdpBrowser, type CdpConnectionSummary } from './cdp-handoff';
import {
  browseLocalBrowserExecutable,
  discoverLocalBrowsers,
  openLocalBrowser,
  type LocalBrowserOption,
} from './local-browser';

const JOB_PREFIX = 'challenge-discovery-job-';
const INDEX_KEY = 'challenge-discovery-index';
const ACTIVE_STRATEGIES_KEY = 'challenge-discovery-active-strategies';
const VERIFIED_SESSIONS_KEY = 'challenge-discovery-verified-browser-sessions';

export interface ChallengeDiscoveryServiceOptions {
  workspaceRoot?: string;
  getBrowserConfig?: () => BrowserConfig | Promise<BrowserConfig>;
  getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
}

export class ChallengeDiscoveryService {
  private readonly browserContexts = new Map<string, BrowserContext>();

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

  async loadVerifiedBrowserSessions(): Promise<void> {
    const sessions = (await this.storage.read<VerifiedBrowserSession[]>(VERIFIED_SESSIONS_KEY)) ?? [];
    const registry = getGlobalVerifiedBrowserSessionRegistry();
    for (const session of sessions) {
      if (!session.cdpUrl || !(await isCdpSessionReachable(session.cdpUrl))) {
        continue;
      }
      registry.register(session);
    }
  }

  async openBrowser(id: string): Promise<ChallengeDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    const browser = await this.getBrowserConfig();
    const network = await this.getNetworkConfig();
    const profileDir = browser.userDataDir || join(this.options.workspaceRoot ?? './data/agent-workspaces', 'challenge-discoveries', job.id, 'browser-profile');
    await fs.mkdir(profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: browser.channel,
      userAgent: network?.userAgent,
      proxy: network?.proxy ? { server: network.proxy } : undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(job.normalizedUrl, { waitUntil: browser.waitUntil ?? 'domcontentloaded', timeout: browser.timeout ?? 30000 }).catch(() => undefined);
    this.browserContexts.set(job.id, context);
    await this.updateJob(job.id, { status: 'browser_open', browserProfileDir: profileDir, error: undefined });
    return this.getRequiredJob(job.id);
  }

  async listLocalBrowsers(): Promise<{ browsers: LocalBrowserOption[] }> {
    return {
      browsers: discoverLocalBrowsers().map((browser) => ({
        ...browser,
        profiles: [],
        defaultProfileId: undefined,
      })),
    };
  }

  async browseBrowserExecutable(): Promise<{ executablePath: string | null }> {
    return { executablePath: await browseLocalBrowserExecutable() };
  }

  async openExternalBrowser(
    id: string,
    options: { executablePath?: string; profileId?: string } = {}
  ): Promise<ChallengeDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    const isolatedProfileDir = options.executablePath
      ? join(this.options.workspaceRoot ?? './data/agent-workspaces', 'challenge-discoveries', job.id, 'external-browser-profile')
      : undefined;
    await this.updateJob(job.id, {
      status: 'external_browser_opening',
      browserExecutablePath: options.executablePath,
      browserProfileId: undefined,
      browserProfileDir: isolatedProfileDir,
      browserProfileDirectory: undefined,
      browserCdpUrl: undefined,
      error: 'Opening verification browser. Wait until the browser window is open, complete verification, then press Continue.',
    });
    const opened = await openLocalBrowser({
      url: job.normalizedUrl,
      executablePath: options.executablePath,
      profileId: undefined,
      userDataDir: isolatedProfileDir,
    });
    await this.updateJob(job.id, {
      status: 'external_browser_open',
      browserCdpUrl: opened.cdpUrl,
      browserExecutablePath: options.executablePath,
      browserProfileId: options.profileId,
      browserProfileDir: opened.userDataDir ?? isolatedProfileDir,
      browserProfileDirectory: opened.profileDirectory,
      error: opened.warning ?? (options.executablePath
        ? opened.cdpUrl
          ? isolatedProfileDir
            ? 'Opened an isolated ComicCrawler browser profile for human verification. After completing verification, press Continue to let ComicCrawler read this browser page.'
            : 'Opened in the selected local browser profile for human verification. After completing verification, press Continue to let ComicCrawler read this browser page.'
          : 'Opened in the selected local browser profile for human verification. This browser does not expose a Chromium CDP session, so ComicCrawler may not be able to read it automatically.'
        : 'Opened in the system browser. ComicCrawler cannot read that browser session automatically; use this for human verification or manual inspection.'),
    });
    return this.getRequiredJob(job.id);
  }

  async testCdpConnection(cdpUrl?: string): Promise<CdpConnectionSummary> {
    const resolved = cdpUrl ?? (await this.getBrowserConfig()).handoff?.cdpUrl;
    if (!resolved) {
      throw new Error('CDP URL is required. Configure browser.handoff.cdpUrl or pass cdpUrl.');
    }
    return inspectCdpBrowser(resolved);
  }

  async inspectCdpPage(id: string, cdpUrl?: string): Promise<ChallengeDiscoveryJob> {
    await this.readCdpPageSnapshot(id, cdpUrl);
    return this.getRequiredJob(id);
  }

  async readCdpPageSnapshot(id: string, cdpUrl?: string): Promise<{
    job: ChallengeDiscoveryJob;
    page: { url: string; title: string; html: string };
  }> {
    const job = await this.getRequiredJob(id);
    const resolved = cdpUrl ?? (await this.getBrowserConfig()).handoff?.cdpUrl;
    if (!resolved) {
      throw new Error('CDP URL is required. Configure browser.handoff.cdpUrl or pass cdpUrl.');
    }
    const page = await findCdpPageHtml({ cdpUrl: resolved, targetUrl: job.normalizedUrl });
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
- Source: user browser CDP attach
- Page URL: ${page.url}
- Page Title: ${page.title}
`,
    });
    return { job: await this.getRequiredJob(id), page };
  }

  async completeHumanVerification(id: string): Promise<ChallengeDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    if (job.status === 'external_browser_opening') {
      await this.updateJob(id, {
        error: 'Verification browser is still opening. Wait for the browser window to finish opening, complete verification, then press Continue again.',
      });
      return this.getRequiredJob(id);
    }
    if (job.browserExecutablePath || job.browserProfileId || job.status === 'external_browser_open') {
      if (!job.browserCdpUrl) {
        await this.updateJob(id, {
          status: 'challenge_required',
          error: job.error ?? [
            'The opened browser session is not readable by ComicCrawler because it did not expose a Chromium debugging connection.',
            'Open the verification browser from ComicCrawler with the isolated profile, or close every window using the selected Chrome profile before reopening it from ComicCrawler.',
            'After the browser opens the manga page and you complete verification, press Continue.',
          ].join(' '),
        });
        return this.getRequiredJob(id);
      }

      try {
        await this.readCdpPageSnapshot(id, job.browserCdpUrl);
        await this.registerVerifiedSession({
          hostname: job.hostname,
          userDataDir: job.browserProfileDir ?? '',
          chromiumProfileDirectory: job.browserProfileDirectory,
          cdpUrl: job.browserCdpUrl,
          sourceJobId: job.id,
          verifiedAt: new Date().toISOString(),
        });
        return this.getRequiredJob(id);
      } catch (error) {
        const latest = await this.getRequiredJob(id);
        if (latest.status === 'external_browser_open') {
          const rawMessage = error instanceof Error ? error.message : String(error);
          const message = /ECONNREFUSED/i.test(rawMessage)
            ? [
                `ComicCrawler could not connect to the browser debugging port (${job.browserCdpUrl}).`,
                'The browser likely reused an already-running profile and ignored the remote-debugging flag.',
                'Close all windows for that browser/profile, open it again from ComicCrawler, complete verification, then press Continue.',
              ].join(' ')
            : rawMessage;
          await this.updateJob(id, {
            status: 'challenge_required',
            browserCdpUrl: undefined,
            error: message,
          });
        }
        return this.getRequiredJob(id);
      }
    }

    const context = this.browserContexts.get(id);
    if (context) {
      const page = context.pages()[0];
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
      await context.close().catch(() => undefined);
      this.browserContexts.delete(id);
    }

    const profileDir = job.browserProfileDir;
    if (!profileDir) {
      await this.updateJob(id, { status: 'challenge_required', error: 'No browser profile was recorded for this handoff.' });
      return this.getRequiredJob(id);
    }

    try {
      await this.renderReady(job.normalizedUrl, { userDataDir: profileDir });
    } catch (error) {
      await this.updateJob(id, {
        status: isAccessBlockedError(error) ? 'access_blocked' : 'challenge_required',
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getRequiredJob(id);
    }
    await this.registerVerifiedSession({
      hostname: job.hostname,
      userDataDir: profileDir,
      chromiumProfileDirectory: job.browserProfileDirectory,
      sourceJobId: job.id,
      verifiedAt: new Date().toISOString(),
    });
    await this.updateJob(id, {
      status: 'ready',
      error: undefined,
      diagnosisMarkdown: '# Challenge Diagnosis\n\n## Status\n\n- Status: ready\n- Human browser verification profile is available for this hostname.\n',
    });
    return this.getRequiredJob(id);
  }

  async get(id: string): Promise<ChallengeDiscoveryJob | null> {
    return this.storage.read<ChallengeDiscoveryJob>(`${JOB_PREFIX}${id}`);
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
      const selfAo = runSelfAoChallengeDiscovery({
        url: job.normalizedUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      const validation = validateChallengeStrategySource(selfAo.candidateSource);
      await this.updateJob(id, {
        status: isAccessBlockedError(error) ? 'access_blocked' : validation.valid ? 'strategy_awaiting_review' : 'failed',
        diagnosisMarkdown: selfAo.diagnosisMarkdown,
        evidenceMarkdown: selfAo.evidenceMarkdown,
        candidateSource: selfAo.candidateSource,
        validation,
        error: validation.valid ? undefined : validation.errors.join(' '),
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
    const sessions = (await this.storage.read<VerifiedBrowserSession[]>(VERIFIED_SESSIONS_KEY)) ?? [];
    await this.storage.write(VERIFIED_SESSIONS_KEY, [
      ...sessions.filter((entry) => entry.hostname !== session.hostname),
      session,
    ]);
  }

  private async getBrowserConfig(): Promise<BrowserConfig> {
    return this.options.getBrowserConfig
      ? await this.options.getBrowserConfig()
      : {
          mode: 'auto',
          headless: true,
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

async function isCdpSessionReachable(cdpUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, '')}/json/version`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
