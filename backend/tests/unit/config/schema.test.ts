import { describe, expect, it } from '@jest/globals';
import { BrowserConfigSchema, validateGlobalConfig } from '../../../src/config/schema';

describe('global config schema', () => {
  globalConfigSchemaTestGroup1();
});

function globalConfigSchemaTestGroup1(): void {
  it('requires a secret path when API security uses token mode', globalConfigSchemaTestRequiresASecretPathWhenAPISecurityUsesTokenMode);
  it('applies Browser Worker timing defaults when browser config is omitted', globalConfigSchemaTestAppliesBrowserWorkerTimingDefaultsWhenBrowserConfigIsOmitted);
  it('accepts Browser Worker command timing settings', globalConfigSchemaTestAcceptsBrowserWorkerCommandTimingSettings);
  it('rejects unknown Browser Worker transport settings', globalConfigSchemaTestRejectsUnknownBrowserWorkerTransportSettings);
}

function globalConfigSchemaTestRequiresASecretPathWhenAPISecurityUsesTokenMode() {
    expect(() => validateGlobalConfig({
        download: { directory: './downloads', concurrency: 5, namingTemplate: '{title}', imageFormat: 'original', imageQuality: 100 },
        concurrency: { taskLevel: 1, siteLevel: 1 },
        network: { timeout: 30000, retries: 3, retryDelay: 1000 },
        server: { port: 4100, host: '127.0.0.1' },
        log: { level: 'info' },
        i18n: { language: 'zh-TW', fallback: 'en' },
        apiSecurity: { mode: 'token', defaultEffect: 'deny', rules: [] },
    })).toThrow(/secretPath/);
}

function globalConfigSchemaTestAppliesBrowserWorkerTimingDefaultsWhenBrowserConfigIsOmitted() {
    const config = validateGlobalConfig(baseConfig());
    expect(config.browser).toEqual({
        timeout: 30000,
        workerWaitTimeoutMs: 1800000,
        postLoadDelayMs: 0,
    });
}

function globalConfigSchemaTestAcceptsBrowserWorkerCommandTimingSettings() {
    const config = validateGlobalConfig({ ...baseConfig(),
        browser: {
            timeout: 45000,
            workerWaitTimeoutMs: 60000,
            postLoadDelayMs: 1000,
        },
    });
    expect(config.browser).toMatchObject({
        timeout: 45000,
        workerWaitTimeoutMs: 60000,
        postLoadDelayMs: 1000,
    });
}

function baseConfig() {
  return {
    download: { directory: './downloads', concurrency: 5,
      namingTemplate: '{title}/{chapter}/{index}', imageFormat: 'original' as const, imageQuality: 100 },
    concurrency: { taskLevel: 3, siteLevel: 2 },
    network: { timeout: 30000, retries: 3, retryDelay: 1000 },
    server: { port: 4100, host: '127.0.0.1' }, log: { level: 'info' as const },
    i18n: { language: 'zh-TW' as const, fallback: 'en' as const },
  };
}

function globalConfigSchemaTestRejectsUnknownBrowserWorkerTransportSettings() {
    expect(() => BrowserConfigSchema.parse({
        timeout: 30000,
        workerWaitTimeoutMs: 60000,
        postLoadDelayMs: 0,
        transport: { protocol: 'custom' },
    })).toThrow(/Unrecognized key/);
}
