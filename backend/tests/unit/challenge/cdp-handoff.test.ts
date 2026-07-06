import { describe, expect, it } from '@jest/globals';
import { inspectCdpBrowser } from '../../../src/challenge/cdp-handoff';

describe('CDP browser handoff', () => {
  it('rejects non-local CDP endpoints', async () => {
    await expect(inspectCdpBrowser('http://example.com:9222')).rejects.toThrow(/localhost|127\.0\.0\.1/);
  });

  it('rejects non-CDP URL protocols', async () => {
    await expect(inspectCdpBrowser('https://127.0.0.1:9222')).rejects.toThrow(/http:\/\/ or ws:\/\//);
  });
});
