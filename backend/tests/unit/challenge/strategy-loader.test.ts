import { describe, expect, it } from '@jest/globals';
import { loadChallengeStrategyFromSource, validateChallengeStrategySource } from '../../../src/challenge';

describe('challenge strategy loader', () => {
  it('loads a constrained TypeScript strategy candidate', async () => {
    const source = `
      export const strategy = {
        id: 'fixture-challenge',
        domains: ['example.com'],
        async detect(ctx) {
          return await ctx.hasText(['Just a moment']) ? ctx.challenge('js_challenge') : ctx.ready();
        },
        async autoAttempt(ctx) {
          await ctx.waitForChallengeToClear(30000);
          return await ctx.isChallenge() ? ctx.challenge('js_challenge') : ctx.ready();
        },
        async verifyReady(ctx) {
          return await ctx.hasSelector('img') ? ctx.ready(['image found']) : ctx.notReady('No image');
        },
      };
    `;

    const strategy = loadChallengeStrategyFromSource(source);
    expect(strategy.id).toBe('fixture-challenge');
    expect(strategy.domains).toEqual(['example.com']);
    await expect(strategy.verifyReady({
      hasSelector: async () => true,
      ready: (evidence?: string[]) => ({ status: 'ready', evidence }),
    } as any)).resolves.toMatchObject({ status: 'ready' });
  });

  it('rejects forbidden browser automation and imports', () => {
    const validation = validateChallengeStrategySource(`
      import fs from 'node:fs';
      export const strategy = {
        id: 'bad',
        domains: ['example.com'],
        async detect(ctx) { await ctx.page.evaluate(() => document.title); return ctx.ready(); },
        async autoAttempt(ctx) { await ctx.click('#captcha'); return ctx.ready(); },
        verifyReady(ctx) { return ctx.ready(); }
      };
    `);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('Imports are not allowed');
    expect(validation.errors.join(' ')).toContain('Direct page.evaluate() is not allowed');
  });
});
