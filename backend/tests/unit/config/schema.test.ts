import { describe, expect, it } from '@jest/globals';
import { validateGlobalConfig } from '../../../src/config/schema';

describe('global config schema', () => {
  it('adds default browser crawler config for legacy configs', () => {
    const config = validateGlobalConfig({
      download: {
        directory: './downloads',
        concurrency: 5,
        namingTemplate: '{title}/{chapter}/{index}',
        imageFormat: 'original',
        imageQuality: 100,
      },
      concurrency: {
        taskLevel: 3,
        siteLevel: 2,
      },
      network: {
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
      },
      server: {
        port: 4100,
        host: '127.0.0.1',
      },
      log: {
        level: 'info',
      },
      i18n: {
        language: 'zh-TW',
        fallback: 'en',
      },
    });

    expect(config.browser).toEqual({
      mode: 'auto',
      headless: true,
      maxInstances: 2,
      timeout: 30000,
      waitUntil: 'domcontentloaded',
      postLoadDelayMs: 0,
      challengeAutoAttempt: true,
      challengeWaitMs: 15000,
      handoff: {
        mode: 'snapshot',
      },
    });
  });

  it('accepts Cloudflare challenge browser session settings', () => {
    const config = validateGlobalConfig({
      download: {
        directory: './downloads',
        concurrency: 5,
        namingTemplate: '{title}/{chapter}/{index}',
        imageFormat: 'original',
        imageQuality: 100,
      },
      concurrency: {
        taskLevel: 3,
        siteLevel: 2,
      },
      network: {
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
      },
      browser: {
        mode: 'headless',
        headless: false,
        maxInstances: 1,
        timeout: 45000,
        waitUntil: 'domcontentloaded',
        postLoadDelayMs: 1000,
        challengeAutoAttempt: true,
        challengeWaitMs: 60000,
        channel: 'chrome',
        storageStatePath: 'D:/secrets/storage-state.json',
        userDataDir: 'D:/profiles/comiccrawler',
        handoff: {
          mode: 'cdp',
          cdpUrl: 'http://127.0.0.1:9222',
        },
      },
      server: {
        port: 4100,
        host: '127.0.0.1',
      },
      log: {
        level: 'info',
      },
      i18n: {
        language: 'zh-TW',
        fallback: 'en',
      },
    });

    expect(config.browser).toMatchObject({
      channel: 'chrome',
      storageStatePath: 'D:/secrets/storage-state.json',
      userDataDir: 'D:/profiles/comiccrawler',
      handoff: {
        mode: 'cdp',
        cdpUrl: 'http://127.0.0.1:9222',
      },
      challengeAutoAttempt: true,
      challengeWaitMs: 60000,
    });
  });
});
