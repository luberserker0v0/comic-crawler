import type { ChallengeStrategyModule, ChallengeStrategyValidation } from './types';

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bimport\s+/m, message: 'Imports are not allowed in challenge strategy candidates.' },
  { pattern: /\brequire\s*\(/m, message: 'require() is not allowed in challenge strategy candidates.' },
  { pattern: /\bprocess\b/m, message: 'process access is not allowed.' },
  { pattern: /\bglobalThis\b|\bglobal\b|\bwindow\b|\bdocument\b/m, message: 'Global object access is not allowed.' },
  { pattern: /\beval\s*\(|\bFunction\s*\(/m, message: 'Dynamic code execution is not allowed.' },
  { pattern: /\bfetch\s*\(/m, message: 'External network calls are not allowed.' },
  { pattern: /\bsetTimeout\s*\(|\bsetInterval\s*\(/m, message: 'Use ctx.wait() instead of timers.' },
  { pattern: /\.evaluate\s*\(/m, message: 'Direct page.evaluate() is not allowed.' },
  { pattern: /\.click\s*\(|\.dblclick\s*\(|\.type\s*\(|\.press\s*\(/m, message: 'Direct click/keyboard automation is not allowed.' },
  { pattern: /\.mouse\b|\.keyboard\b/m, message: 'Direct mouse/keyboard automation is not allowed.' },
  { pattern: /stealth|fingerprint|captcha|turnstile.*click/i, message: 'Stealth/fingerprint/CAPTCHA automation is not allowed.' },
];

export function validateChallengeStrategySource(source: string): ChallengeStrategyValidation {
  const errors = FORBIDDEN_PATTERNS
    .filter((rule) => rule.pattern.test(source))
    .map((rule) => rule.message);

  if (!/\bstrategy\b/.test(source)) {
    errors.push('Candidate must export or assign a strategy object.');
  }

  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)),
    warnings: [],
  };
}

export function validateChallengeStrategyModule(value: unknown): ChallengeStrategyValidation {
  const errors: string[] = [];
  const strategy = value as Partial<ChallengeStrategyModule> | undefined;
  if (!strategy || typeof strategy !== 'object') errors.push('strategy must be an object.');
  if (!strategy?.id || typeof strategy.id !== 'string') errors.push('strategy.id is required.');
  if (!Array.isArray(strategy?.domains) || strategy.domains.length === 0) errors.push('strategy.domains must be a non-empty array.');
  for (const fn of ['detect', 'autoAttempt', 'verifyReady'] as const) {
    if (typeof strategy?.[fn] !== 'function') errors.push(`strategy.${fn} must be a function.`);
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}
