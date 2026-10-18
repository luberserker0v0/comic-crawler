import { describe, expect, it } from '@jest/globals';
import { BrowserConfigSchema, validateGlobalConfig } from '../../../src/config/schema';

describe('global config schema', () => {
  it('requires a secret path when API security uses token mode', () => {
    expect(() => validateGlobalConfig({
      download: { directory: './downloads', concurrency: 5, namingTemplate: '{title}', imageFormat: 'original', imageQuality: 100 },
      concurrency: { taskLevel: 1, siteLevel: 1 },
      network: { timeout: 30000, retries: 3, retryDelay: 1000 },
      server: { port: 4100, host: '127.0.0.1' },
      log: { level: 'info' },
      i18n: { language: 'zh-TW', fallback: 'en' },
      apiSecurity: { mode: 'token', defaultEffect: 'deny', rules: [] },
    })).toThrow(/secretPath/);
  });

  it('applies Browser Worker timing defaults when browser config is omitted', () => {
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
      timeout: 30000,
      workerWaitTimeoutMs: 1800000,
      postLoadDelayMs: 0,
    });
  });

  it('accepts Browser Worker command timing settings', () => {
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
        timeout: 45000,
        workerWaitTimeoutMs: 60000,
        postLoadDelayMs: 1000,
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
      timeout: 45000,
      workerWaitTimeoutMs: 60000,
      postLoadDelayMs: 1000,
    });
  });

  it('rejects unknown Browser Worker transport settings', () => {
    expect(() => BrowserConfigSchema.parse({
      timeout: 30000,
      workerWaitTimeoutMs: 60000,
      postLoadDelayMs: 0,
      transport: { protocol: 'custom' },
    })).toThrow(/Unrecognized key/);
  });
});
