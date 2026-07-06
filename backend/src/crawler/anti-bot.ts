import type { Page } from 'playwright';
import { ComicError, ErrorType } from '../error/types';

export function looksLikeAntiBotChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  const hasChallengeSignal = (
    lower.includes('attention required! | cloudflare') ||
    lower.includes('cdn-cgi/challenge-platform') ||
    lower.includes('window.__cf$cv') ||
    lower.includes('cf-chl') ||
    lower.includes('cf-error') ||
    lower.includes('cloudflare ray id') ||
    lower.includes('sorry, you have been blocked') ||
    lower.includes('you are unable to access') ||
    lower.includes('verify you are human') ||
    lower.includes('checking if the site connection is secure')
  );
  if (!hasChallengeSignal) {
    return false;
  }

  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const anchorCount = (html.match(/<a\s/gi) ?? []).length;
  return (
    (imageCount === 0 && anchorCount === 0) ||
    lower.includes('attention required! | cloudflare') ||
    lower.includes('sorry, you have been blocked') ||
    lower.includes('you are unable to access')
  );
}

export function looksLikeAccessBlocked(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes('sorry, you have been blocked') || lower.includes('you are unable to access');
}

export function assertNotAntiBotChallenge(html: string, url: string): void {
  if (!looksLikeAntiBotChallenge(html)) {
    return;
  }

  throw new ComicError(
    `Anti-bot challenge page detected while fetching ${url}. Playwright rendered the challenge page instead of the comic DOM. Configure a user-provided browser session storageStatePath or userDataDir after solving the challenge manually.`,
    ErrorType.NETWORK_ERROR,
    false,
    { url, antiBotChallenge: true }
  );
}

export async function waitForAntiBotChallengeToClear(
  page: Page,
  url: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 0;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  let html = await page.content();
  if (!looksLikeAntiBotChallenge(html)) {
    return html;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(Math.min(pollIntervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
    html = await page.content();
    if (!looksLikeAntiBotChallenge(html)) {
      return html;
    }
  }

  assertNotAntiBotChallenge(html, url);
  return html;
}
