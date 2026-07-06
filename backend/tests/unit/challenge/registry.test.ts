import { describe, expect, it } from '@jest/globals';
import { ChallengeStrategyRegistry, defaultChallengeStrategy } from '../../../src/challenge';

describe('ChallengeStrategyRegistry', () => {
  it('prefers domain-specific promoted strategies over default wildcard strategy', () => {
    const registry = new ChallengeStrategyRegistry();
    registry.register({
      id: 'example-specific',
      domains: ['example.com'],
      detect: (ctx) => ctx.ready(),
      autoAttempt: (ctx) => ctx.ready(),
      verifyReady: (ctx) => ctx.ready(),
    });

    expect(registry.findByUrl('https://example.com/chapter').id).toBe('example-specific');
    expect(registry.findByUrl('https://other.example.com/chapter').id).toBe('example-specific');
    expect(registry.findByUrl('https://unmatched.test/chapter').id).toBe(defaultChallengeStrategy.id);
  });
});
