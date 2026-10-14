import { describe, expect, it, jest } from '@jest/globals';

const connect = jest.fn();

jest.mock('playwright', () => ({
  chromium: {
    connect,
  },
}));

import { findPageHtmlInContexts, inspectRemoteBrowser } from '../../../src/challenge/remote-handoff';

describe('remote Playwright browser handoff', () => {
  it('accepts remote hosts but requires a Playwright WebSocket endpoint', async () => {
    await expect(inspectRemoteBrowser('http://example.com:3000')).rejects.toThrow(/ws:\/\/ or wss:\/\//);
  });

  it('rejects non-WebSocket URL protocols', async () => {
    await expect(inspectRemoteBrowser('https://browser.example:3000')).rejects.toThrow(/ws:\/\/ or wss:\/\//);
  });

  it('reuses a same-host verified page by navigating it to the requested chapter URL', async () => {
    const targetUrl = 'https://m.happymh.com/mangaread/demo/1';
    const page = createMockPage('https://m.happymh.com/manga/demo', '<main><img src="https://img.happymh.com/demo/1.webp"></main>');
    const context = { pages: () => [page] };
    const result = await findPageHtmlInContexts([context as never], {
      targetUrl,
    });

    expect(page.goto).toHaveBeenCalledWith(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    expect(result.html).toContain('img.happymh.com');
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
