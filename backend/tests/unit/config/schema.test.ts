import { describe, expect, it } from '@jest/globals';
import { validateGlobalConfig } from '../../../src/config/schema';

describe('global config schema', () => {
  it('applies the remote browser defaults when browser config is omitted', () => {
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
      mode: 'remote',
      maxInstances: 2,
      timeout: 30000,
      waitUntil: 'domcontentloaded',
      postLoadDelayMs: 0,
      challengeAutoAttempt: true,
      challengeWaitMs: 15000,
      remote: {
        connectTimeout: 30000,
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
        mode: 'remote',
        maxInstances: 1,
        timeout: 45000,
        waitUntil: 'domcontentloaded',
        postLoadDelayMs: 1000,
        challengeAutoAttempt: true,
        challengeWaitMs: 60000,
        storageStatePath: 'D:/secrets/storage-state.json',
        remote: {
          connectTimeout: 45000,
          exposeNetwork: '<loopback>',
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
      storageStatePath: 'D:/secrets/storage-state.json',
      remote: {
        connectTimeout: 45000,
        exposeNetwork: '<loopback>',
      },
      challengeAutoAttempt: true,
      challengeWaitMs: 60000,
    });
  });
});
