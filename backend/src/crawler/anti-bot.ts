import { ComicError, ErrorType } from '../error/types';

export function looksLikeAntiBotChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  if (!CHALLENGE_SIGNALS.some((signal) => lower.includes(signal))) return false;
  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const anchorCount = (html.match(/<a\s/gi) ?? []).length;
  const isSparseChallengeDocument = imageCount === 0 && anchorCount === 0;
  return isSparseChallengeDocument || BLOCK_SIGNALS.some((signal) => lower.includes(signal));
}

const BLOCK_SIGNALS = ['attention required! | cloudflare', 'sorry, you have been blocked', 'you are unable to access'];
const CHALLENGE_SIGNALS = [
  ...BLOCK_SIGNALS, 'cdn-cgi/challenge-platform', 'window.__cf$cv', 'cf-chl', 'cf-error',
  'cloudflare ray id', 'verify you are human', 'checking if the site connection is secure',
  '<title>請稍候', '<title>请稍候', '正在執行安全驗證', '正在执行安全验证',
  '人机验证', '人機驗證', '嗨皮漫画——人机验证', '嗨皮漫畫——人機驗證',
];

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
