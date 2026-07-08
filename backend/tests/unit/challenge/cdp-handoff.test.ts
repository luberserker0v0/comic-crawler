import { describe, expect, it, jest } from '@jest/globals';

const connectOverCDP = jest.fn();

jest.mock('playwright', () => ({
  chromium: {
    connectOverCDP,
  },
}));

import { findCdpPageHtml, inspectCdpBrowser } from '../../../src/challenge/cdp-handoff';

describe('CDP browser handoff', () => {
  it('rejects non-local CDP endpoints', async () => {
    await expect(inspectCdpBrowser('http://example.com:9222')).rejects.toThrow(/localhost|127\.0\.0\.1/);
  });

  it('rejects non-CDP URL protocols', async () => {
    await expect(inspectCdpBrowser('https://127.0.0.1:9222')).rejects.toThrow(/http:\/\/ or ws:\/\//);
  });

  it('reuses a same-host verified page by navigating it to the requested chapter URL', async () => {
    const targetUrl = 'https://m.happymh.com/mangaread/demo/1';
    const page = createMockPage('https://m.happymh.com/manga/demo', '<main><img src="https://img.happymh.com/demo/1.webp"></main>');
    const browser = {
      contexts: jest.fn(() => [{ pages: () => [page] }]),
      close: jest.fn(async () => undefined),
    };
    connectOverCDP.mockResolvedValue(browser as never);

    const result = await findCdpPageHtml({
      cdpUrl: 'http://127.0.0.1:9222',
      targetUrl,
    });

    expect(page.goto).toHaveBeenCalledWith(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    expect(result.html).toContain('img.happymh.com');
    expect(browser.close).toHaveBeenCalled();
  });
});

function createMockPage(initialUrl: string, html: string): any {
  let currentUrl = initialUrl;
  return {
    url: jest.fn(() => currentUrl),
    title: jest.fn(async () => 'demo'),
    content: jest.fn(async () => html),
    goto: jest.fn(async (url: string) => {
      currentUrl = url;
      return undefined;
    }),
    evaluate: jest.fn(async () => undefined),
    waitForLoadState: jest.fn(async () => undefined),
    waitForTimeout: jest.fn(async () => undefined),
    locator: jest.fn(() => ({
      filter: jest.fn().mockReturnThis(),
      first: jest.fn().mockReturnThis(),
      count: jest.fn(async () => 0),
      click: jest.fn(async () => undefined),
    })),
  };
}
