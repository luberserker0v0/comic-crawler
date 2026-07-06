import type { Page } from 'playwright';
import { ComicError, ErrorType } from '../error/types';
import { PlaywrightChallengeContext } from './challenge-context';
import type { ChallengeDecision, ChallengeStrategyModule } from './types';
import { ChallengeStrategyRegistry, getGlobalChallengeStrategyRegistry } from './registry';

export interface BrowserChallengeHandlerOptions {
  challengeAutoAttempt?: boolean;
  challengeWaitMs?: number;
}

export class BrowserChallengeHandler {
  constructor(private readonly registry = getGlobalChallengeStrategyRegistry()) {}

  async ensureReady(
    page: Page,
    url: string,
    options: BrowserChallengeHandlerOptions = {}
  ): Promise<{ html: string; strategyId: string; decision: ChallengeDecision }> {
    const strategy = this.registry.findByUrl(url);
    const ctx = new PlaywrightChallengeContext(page);
    let decision = await strategy.detect(ctx);

    if (decision.status !== 'ready' && options.challengeAutoAttempt !== false) {
      decision = await this.runAutoAttempt(strategy, ctx, options.challengeWaitMs);
      if (decision.status === 'ready') {
        decision = await strategy.verifyReady(ctx);
      }
    }

    if (decision.status !== 'ready') {
      throw new ComicError(
        `Browser challenge was not cleared for ${url}: ${decision.reason ?? decision.challengeType ?? decision.status}`,
        ErrorType.NETWORK_ERROR,
        false,
        {
          url,
          antiBotChallenge: true,
          strategyId: strategy.id,
          decision,
        }
      );
    }

    return {
      html: await ctx.html(),
      strategyId: strategy.id,
      decision,
    };
  }

  private async runAutoAttempt(
    strategy: ChallengeStrategyModule,
    ctx: PlaywrightChallengeContext,
    challengeWaitMs = 15_000
  ): Promise<ChallengeDecision> {
    const originalWait = ctx.waitForChallengeToClear.bind(ctx);
    const patchedCtx = Object.create(ctx) as PlaywrightChallengeContext;
    patchedCtx.waitForChallengeToClear = async (timeoutMs: number) => originalWait(Math.min(timeoutMs, challengeWaitMs));
    return strategy.autoAttempt(patchedCtx);
  }
}
