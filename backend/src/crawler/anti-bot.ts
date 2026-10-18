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
    lower.includes('checking if the site connection is secure') ||
    lower.includes('<title>請稍候') ||
    lower.includes('<title>请稍候') ||
    lower.includes('正在執行安全驗證') ||
    lower.includes('正在执行安全验证') ||
    lower.includes('人机验证') ||
    lower.includes('人機驗證') ||
    lower.includes('嗨皮漫画——人机验证') ||
    lower.includes('嗨皮漫畫——人機驗證')
  );
  if (!hasChallengeSignal) {
    return false;
  }

  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const anchorCount = (html.match(/<a\s/gi) ?? []).length;
  const isSparseChallengeDocument = imageCount === 0 && anchorCount === 0;
  return (
    isSparseChallengeDocument ||
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
    `Anti-bot challenge page detected while fetching ${url}. Complete verification in the task-bound Browser Worker session, then resume the task.`,
    ErrorType.NETWORK_ERROR,
    false,
    { url, antiBotChallenge: true }
  );
}
