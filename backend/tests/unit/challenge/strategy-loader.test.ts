import { describe, expect, it } from '@jest/globals';
import { loadChallengeStrategyFromSource, validateChallengeStrategySource } from '../../../src/challenge';

describe('challenge strategy loader', () => {
  challengeStrategyLoaderTestGroup1();
});

function challengeStrategyLoaderTestGroup1(): void {
  it('loads a constrained TypeScript strategy candidate', challengeStrategyLoaderTestLoadsAConstrainedTypeScriptStrategyCandidate);
  it('rejects forbidden browser automation and imports', challengeStrategyLoaderTestRejectsForbiddenBrowserAutomationAndImports);
}

async function challengeStrategyLoaderTestLoadsAConstrainedTypeScriptStrategyCandidate() {
    const strategy = loadChallengeStrategyFromSource(validStrategySource());
    expect(strategy.id).toBe('fixture-challenge');
    expect(strategy.domains).toEqual(['example.com']);
    await expect(strategy.verifyReady({
        hasSelector: async () => true,
        ready: (evidence?: string[]) => ({ status: 'ready', evidence }),
    } as any)).resolves.toMatchObject({ status: 'ready' });
}

function validStrategySource(): string {
  return `
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
}

function challengeStrategyLoaderTestRejectsForbiddenBrowserAutomationAndImports() {
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
}
