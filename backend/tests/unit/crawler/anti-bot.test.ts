import { describe, expect, it } from '@jest/globals';
import {
  assertNotAntiBotChallenge,
  looksLikeAntiBotChallenge,
  waitForAntiBotChallengeToClear,
} from '../../../src/crawler/anti-bot';
import { ComicError, ErrorType } from '../../../src/error/types';

describe('anti-bot challenge detection', () => {
  it('detects Cloudflare challenge pages without comic DOM', () => {
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
    try {
      assertNotAntiBotChallenge(html, 'https://example.com/chapter');
    } catch (error) {
      expect(error).toMatchObject({
        type: ErrorType.NETWORK_ERROR,
        context: expect.objectContaining({ antiBotChallenge: true }),
      });
    }
  });

  it('does not flag normal comic DOM that mentions Cloudflare in unrelated text', () => {
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
  });

  it('detects explicit Cloudflare blocked pages even if they contain links', () => {
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
  });

  it('waits for JavaScript challenge pages to become normal DOM', async () => {
    const challengeHtml = `<!doctype html><title>Attention Required! | Cloudflare</title><script src="/cdn-cgi/challenge-platform/x.js"></script>`;
    const normalHtml = `<!doctype html><a href="/chapter-1">Chapter 1</a><img src="/page-1.jpg" />`;
    const contents = [challengeHtml, challengeHtml, normalHtml];
    const page = {
      content: async () => contents.shift() ?? normalHtml,
      waitForTimeout: async () => undefined,
    };

    await expect(waitForAntiBotChallengeToClear(page as any, 'https://example.com/chapter', {
      timeoutMs: 5000,
      pollIntervalMs: 1,
    })).resolves.toBe(normalHtml);
  });
});
