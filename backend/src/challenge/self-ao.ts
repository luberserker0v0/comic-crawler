import { URL } from 'node:url';

export interface SelfAoChallengeInput {
  url: string;
  html?: string;
  error?: string;
}

export interface SelfAoChallengeOutput {
  diagnosisMarkdown: string;
  evidenceMarkdown: string;
  candidateSource: string;
}

export function runSelfAoChallengeDiscovery(input: SelfAoChallengeInput): SelfAoChallengeOutput {
  const parsed = new URL(input.url);
  const strategyId = `${slugify(parsed.hostname)}-challenge`;
  const domain = parsed.hostname;
  const challengeSignals = collectChallengeSignals(input.html ?? input.error ?? '');
  const challengeType = isExplicitAccessBlock(input.html ?? input.error ?? '')
    ? 'access_blocked'
    : 'anti_bot_js_challenge';
  const diagnosisMarkdown = `# Challenge Diagnosis

## Status

- Status: challenge_detected
- Challenge Type: ${challengeType}
- Target URL: ${input.url}

## Evidence

${formatList(challengeSignals.length > 0 ? challengeSignals : ['The page did not reach a verified comic DOM during browser rendering.'])}

## Required Action

- Try Playwright-native waiting and one reload.
- If the challenge remains, require headed browser handoff and user-owned session.
- If the browser reaches an explicit blocked page, stop and report access_blocked instead of sending blocked HTML to selector-discovery.
- Do not run selector-discovery against challenge DOM.
`;

  const evidenceMarkdown = `# Browser Render Evidence

## Source URL

${input.url}

## Render Result

${input.error ? `- Error: ${input.error}` : '- HTML was available but did not pass readiness checks.'}

## Strategy Authoring Notes

- Use only the provided ctx API.
- Do not click verification controls.
- Do not use imports, process, page.evaluate, keyboard, mouse, or external network calls.
`;

  const candidateSource = `export const strategy = {
  id: '${strategyId}',
  name: '${domain} browser challenge strategy',
  domains: ['${domain}'],

  async detect(ctx) {
    const hasChallengeText = await ctx.hasText([
      'Attention Required',
      'Just a moment',
      'You need to enable JavaScript',
      'Verify you are human',
      'Checking if the site connection is secure',
      'Sorry, you have been blocked',
      'You are unable to access'
    ]);
    if (await ctx.hasText(['Sorry, you have been blocked', 'You are unable to access'])) {
      return ctx.challenge('access_blocked', ['site explicitly blocked this browser/session']);
    }
    const hasChallengeScript = await ctx.hasScript('/cdn-cgi/challenge-platform');
    const hasChallengeFrame = await ctx.hasIframe('challenges.cloudflare.com');
    const hasComicImageCandidate = await ctx.hasSelector('img, [data-src], picture source');
    if ((hasChallengeText || hasChallengeScript || hasChallengeFrame || await ctx.isChallenge()) && !hasComicImageCandidate) {
      return ctx.challenge('anti_bot_js_challenge', ['challenge signals present and comic image candidates absent']);
    }
    return ctx.ready(['challenge signals absent or comic DOM candidates present']);
  },

  async autoAttempt(ctx) {
    const cleared = await ctx.waitForChallengeToClear(60000);
    if (!cleared) {
      await ctx.reload();
      await ctx.waitForChallengeToClear(60000);
    }
    return await ctx.isChallenge()
      ? ctx.challenge('anti_bot_js_challenge', ['challenge remained after wait and reload'])
      : ctx.ready(['challenge cleared after Playwright-native wait']);
  },

  async verifyReady(ctx) {
    if (await ctx.isChallenge()) {
      return ctx.challenge('anti_bot_js_challenge', ['challenge signals are still present']);
    }
    return await ctx.hasSelector('img, [data-src], picture source')
      ? ctx.ready(['comic image candidate found'])
      : ctx.notReady('No comic image candidate found after challenge handling');
  }
};
`;

  return { diagnosisMarkdown, evidenceMarkdown, candidateSource };
}

function collectChallengeSignals(text: string): string[] {
  const lower = text.toLowerCase();
  const signals: string[] = [];
  if (lower.includes('cloudflare')) signals.push('Cloudflare signal detected.');
  if (lower.includes('attention required')) signals.push('Page title/text includes Attention Required.');
  if (lower.includes('sorry, you have been blocked')) signals.push('Page explicitly says the browser/session has been blocked.');
  if (lower.includes('you are unable to access')) signals.push('Page explicitly says access is unavailable for this browser/session.');
  if (lower.includes('cdn-cgi/challenge-platform')) signals.push('Script includes /cdn-cgi/challenge-platform.');
  if (lower.includes('you need to enable javascript')) signals.push('Body text includes JavaScript requirement.');
  if (lower.includes('anti-bot') || lower.includes('challenge')) signals.push('Browser challenge error text was reported.');
  return Array.from(new Set(signals));
}

function isExplicitAccessBlock(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('access_blocked') || lower.includes('sorry, you have been blocked') || lower.includes('you are unable to access');
}

function formatList(values: string[]): string {
  return values.map((value) => `- ${value}`).join('\n');
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
}
