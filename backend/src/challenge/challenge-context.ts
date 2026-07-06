import type { Page } from 'playwright';
import type { ChallengeContext, ChallengeDecision } from './types';
import { looksLikeAntiBotChallenge } from '../crawler/anti-bot';

const MAX_WAIT_MS = 120_000;

export class PlaywrightChallengeContext implements ChallengeContext {
  constructor(private readonly page: Page) {}

  async title(): Promise<string> {
    return this.page.title().catch(() => '');
  }

  async text(): Promise<string> {
    return this.page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  }

  async html(): Promise<string> {
    return this.page.content();
  }

  async hasText(patterns: string[]): Promise<boolean> {
    const text = `${await this.title()}\n${await this.text()}`.toLowerCase();
    return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
  }

  async hasSelector(selector: string): Promise<boolean> {
    return (await this.page.locator(selector).count().catch(() => 0)) > 0;
  }

  async hasScript(pattern: string): Promise<boolean> {
    const scripts = await this.page.locator('script[src]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('src') ?? '')
    ).catch(() => []);
    return scripts.some((src) => src.includes(pattern));
  }

  async hasIframe(pattern: string): Promise<boolean> {
    const iframes = await this.page.locator('iframe[src]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('src') ?? '')
    ).catch(() => []);
    return iframes.some((src) => src.includes(pattern));
  }

  async wait(ms: number): Promise<void> {
    await this.page.waitForTimeout(clampWait(ms));
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  }

  async waitForSelector(selector: string, timeoutMs = 30_000): Promise<boolean> {
    await this.page.waitForSelector(selector, {
      state: 'attached',
      timeout: clampWait(timeoutMs),
    }).catch(() => undefined);
    return this.hasSelector(selector);
  }

  async waitForChallengeToClear(timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < clampWait(timeoutMs)) {
      if (!await this.isChallenge()) return true;
      await this.wait(1000);
    }
    return !await this.isChallenge();
  }

  ready(evidence: string[] = []): ChallengeDecision {
    return { status: 'ready', evidence };
  }

  challenge(challengeType: string, evidence: string[] = []): ChallengeDecision {
    return { status: 'challenge_detected', challengeType, evidence };
  }

  notReady(reason: string, evidence: string[] = []): ChallengeDecision {
    return { status: 'not_ready', reason, evidence };
  }

  async isChallenge(): Promise<boolean> {
    return looksLikeAntiBotChallenge(await this.html());
  }
}

function clampWait(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, MAX_WAIT_MS);
}
