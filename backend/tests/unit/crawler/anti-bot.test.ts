import { describe, expect, it } from '@jest/globals';
import {
  assertNotAntiBotChallenge,
  looksLikeAntiBotChallenge,
} from '../../../src/crawler/anti-bot';
import { ComicError, ErrorType } from '../../../src/error/types';

describe('anti-bot challenge detection', () => {
  antiBotChallengeDetectionTestGroup1();
});

function antiBotChallengeDetectionTestGroup1(): void {
  it('detects Cloudflare challenge pages without comic DOM', antiBotChallengeDetectionTestDetectsCloudflareChallengePagesWithoutComicDOM);
  it('does not flag normal comic DOM that mentions Cloudflare in unrelated text', antiBotChallengeDetectionTestDoesNotFlagNormalComicDOMThatMentionsCloudflareInUnrelatedText);
  it('detects explicit Cloudflare blocked pages even if they contain links', antiBotChallengeDetectionTestDetectsExplicitCloudflareBlockedPagesEvenIfTheyContainLinks);
  it('detects HappyMH Chinese human verification pages', antiBotChallengeDetectionTestDetectsHappyMHChineseHumanVerificationPages);
  it('detects localized Cloudflare waiting pages', antiBotChallengeDetectionTestDetectsLocalizedCloudflareWaitingPages);
  it('does not flag normal HappyMH comic DOM that only keeps verification words in scripts', antiBotChallengeDetectionTestDoesNotFlagNormalHappyMHComicDOMThatOnlyKeepsVerificationWordsInScripts);
}

function antiBotChallengeDetectionTestDetectsCloudflareChallengePagesWithoutComicDOM() {
    const html = `<!doctype html>
      <html>
        <head><title>Attention Required! | Cloudflare</title></head>
        <body>
          <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
          Cloudflare Ray ID
        </body>
      </html>`;
    expect(looksLikeAntiBotChallenge(html)).toBe(true);
    expect(() => assertNotAntiBotChallenge(html, 'https://example.com/chapter')).toThrow(ComicError);
    expectCloudflareNetworkError(html);
}

function expectCloudflareNetworkError(html: string): void {
    try {
        assertNotAntiBotChallenge(html, 'https://example.com/chapter');
    }
    catch (error) {
        expect(error).toMatchObject({
            type: ErrorType.NETWORK_ERROR,
            context: expect.objectContaining({ antiBotChallenge: true }),
        });
    }
}

function antiBotChallengeDetectionTestDoesNotFlagNormalComicDOMThatMentionsCloudflareInUnrelatedText() {
    const html = `<!doctype html>
      <html>
        <body>
          <a href="/chapter-1">Chapter 1</a>
          <img src="/page-1.jpg" />
          <p>Hosted behind Cloudflare CDN.</p>
        </body>
      </html>`;
    expect(looksLikeAntiBotChallenge(html)).toBe(false);
    expect(() => assertNotAntiBotChallenge(html, 'https://example.com/chapter')).not.toThrow();
}

function antiBotChallengeDetectionTestDetectsExplicitCloudflareBlockedPagesEvenIfTheyContainLinks() {
    const html = `<!doctype html>
      <html>
        <head><title>Sorry, you have been blocked</title></head>
        <body>
          <h1>Sorry, you have been blocked</h1>
          <p>You are unable to access happymh.com</p>
          <a href="https://www.cloudflare.com/">Cloudflare</a>
        </body>
      </html>`;
    expect(looksLikeAntiBotChallenge(html)).toBe(true);
    expect(() => assertNotAntiBotChallenge(html, 'https://m.happymh.com/chapter')).toThrow(ComicError);
}

function antiBotChallengeDetectionTestDetectsHappyMHChineseHumanVerificationPages() {
    const html = `<!doctype html>
      <html>
        <head><title>嗨皮漫画——人机验证</title></head>
        <body>
          <h1>人机验证</h1>
          <p>请完成验证后继续阅读漫画。</p>
        </body>
      </html>`;
    expect(looksLikeAntiBotChallenge(html)).toBe(true);
    expect(() => assertNotAntiBotChallenge(html, 'https://m.happymh.com/manga/demo')).toThrow(ComicError);
}

function antiBotChallengeDetectionTestDetectsLocalizedCloudflareWaitingPages() {
    const html = `<!doctype html>
      <html>
        <head><title>請稍候...</title></head>
        <body><div>正在執行安全驗證</div></body>
      </html>`;
    expect(looksLikeAntiBotChallenge(html)).toBe(true);
    expect(() => assertNotAntiBotChallenge(html, 'https://comix.to/title/demo')).toThrow(ComicError);
}

function antiBotChallengeDetectionTestDoesNotFlagNormalHappyMHComicDOMThatOnlyKeepsVerificationWordsInScripts() {
    const html = `<!doctype html>
      <html>
        <head><title>我在星际国家当恶德领主 - 嗨皮漫画</title></head>
        <body>
          <h1>我在星际国家当恶德领主</h1>
          <a href="/mangaread/demo/1">第1话</a>
          <img src="/cover/demo.jpg" />
          <script>window.i18n = {"challengeLabel":"人机验证"}</script>
        </body>
      </html>`;
    expect(looksLikeAntiBotChallenge(html)).toBe(false);
    expect(() => assertNotAntiBotChallenge(html, 'https://m.happymh.com/manga/demo')).not.toThrow();
}
