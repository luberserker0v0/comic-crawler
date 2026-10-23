import { describe, expect, it } from '@jest/globals';
import type { BrowserResourceSummary, BrowserWorkerSummary } from '@comiccrawler/shared';
import { browserTargetMissingForRun, buildBrowserTargetOptions } from '../../../src/pages/lab/useBrowserTargets';

const targetUrl = 'https://comix.to/title/demo/11212633-chapter-51.1';

describe('Adapter Lab browser targets', () => {
  it('selects an idle existing tab registered for the exact chapter URL', () => {
    const options = buildBrowserTargetOptions([worker('existing-tab')], [resource(targetUrl)], targetUrl);
    expect(options).toEqual([expect.objectContaining({ kind: 'existing-tab', target: {
      mode: 'existing-tab', workerId: 'worker-1', resourceId: 'resource-1',
    } })]);
  });

  it('excludes unrelated tabs and busy workers', () => {
    const busy = { ...worker('existing-tab'), status: 'busy' as const };
    expect(buildBrowserTargetOptions([busy], [resource(targetUrl)], targetUrl)).toEqual([]);
    expect(buildBrowserTargetOptions([worker('existing-tab')], [resource('https://comix.to/other')], targetUrl)).toEqual([]);
  });

  it('offers an idle managed profile worker', () => {
    const options = buildBrowserTargetOptions([worker('managed-profile')], [], targetUrl);
    expect(options[0]?.target).toEqual({ mode: 'managed-profile', workerId: 'worker-1' });
  });
});

it('resumes a verified handoff without requiring an idle Browser target', () => {
  expect(browserTargetMissingForRun(true, 'chal-ready', undefined)).toBe(false);
  expect(browserTargetMissingForRun(true, undefined, undefined)).toBe(true);
});

function worker(executionMode: 'existing-tab' | 'managed-profile'): BrowserWorkerSummary {
  return { workerId: 'worker-1', name: 'Browser Client', status: 'idle', online: true,
    capabilities: { executionMode } };
}

function resource(url: string): BrowserResourceSummary {
  return { resourceId: 'resource-1', workerId: 'worker-1', kind: 'tab', url,
    title: 'Comix chapter', registeredAt: '2026-10-23T00:00:00.000Z' };
}
