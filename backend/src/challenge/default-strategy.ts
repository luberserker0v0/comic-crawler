import type { ChallengeStrategyModule } from './types';

export const defaultChallengeStrategy: ChallengeStrategyModule = {
  id: 'default-browser-challenge',
  name: 'Default Browser Challenge Strategy',
  domains: ['*'],

  async detect(ctx) {
    if (await ctx.isChallenge()) {
      return ctx.challenge('anti_bot_challenge', ['Generic anti-bot challenge signals are present.']);
    }
    return ctx.ready(['No generic anti-bot challenge signals detected.']);
  },

  async autoAttempt(ctx) {
    const cleared = await ctx.waitForChallengeToClear(120_000);
    if (cleared) return { ...ctx.ready(['Challenge cleared while waiting.']), attempts: 1 };
    return { ...ctx.challenge('anti_bot_challenge', ['Challenge remained after default wait.']), attempts: 1 };
  },

  async verifyReady(ctx) {
    if (await ctx.isChallenge()) {
      return ctx.challenge('anti_bot_challenge', ['Challenge signals are still present.']);
    }
    return ctx.ready(['Page is no longer a generic challenge page.']);
  },
};
