import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { AdapterBase } from '../../../src/adapter/base';
import { FixtureCaptureService } from '../../../src/fixtures/fixture-capture-service';

class ChapterFixtureAdapter extends AdapterBase {
  readonly id = 'fixture-chapter';
  readonly name = 'Fixture Chapter';
  readonly domains = ['example.com'];
  readonly parseMode = 'playwright' as const;

  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'example.com';
  }

  extractTitle(): string {
    return 'Fixture';
  }

  extractChapterList(): [] {
    return [];
  }

  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.asCheerio(document);
    return $('#reader img').map((_, element) => this.resolveUrl(sourceUrl, $(element).attr('src') ?? '')).get();
  }
}

const roots: string[] = [];

describe('FixtureCaptureService approved adapter fixtures', () => {
  FixtureCaptureServiceApprovedAdapterFixturesTestGroup1();
});

function FixtureCaptureServiceApprovedAdapterFixturesTestGroup1(): void {
  afterEach(FixtureCaptureServiceApprovedAdapterFixturesTestScenario1);
  it('captures approved page input and golden output', FixtureCaptureServiceApprovedAdapterFixturesTestCapturesApprovedPageInputAndGoldenOutput);
  it('replays an approved fixture against the current adapter', FixtureCaptureServiceApprovedAdapterFixturesTestReplaysAnApprovedFixtureAgainstTheCurrentAdapter);
  it('rejects empty chapter image output', FixtureCaptureServiceApprovedAdapterFixturesTestRejectsEmptyChapterImageOutput);
}

async function FixtureCaptureServiceApprovedAdapterFixturesTestScenario1() {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

async function FixtureCaptureServiceApprovedAdapterFixturesTestCapturesApprovedPageInputAndGoldenOutput() {
    const root = await mkdtemp(join(tmpdir(), 'comiccrawler-fixture-'));
    roots.push(root);
    const service = new FixtureCaptureService({} as never, root);
    const adapter = new ChapterFixtureAdapter();
    const fixture = await captureChapterFixture(service, adapter,
      '<html><body><main id="reader"><img src="/1.webp"><img src="/2.webp"></main></body></html>');
    expect(fixture.path).toContain(join('approved-fixtures', 'fixture-chapter',
      'v2026.10.23-fixture', fixture.id));
    expect(await readFile(fixture.path, 'utf-8')).toContain('/1.webp');
    const expected = JSON.parse(await readFile(fixture.expectedPath!, 'utf-8'));
    expect(expected.results.extractChapterImageUrls.imageUrls).toEqual([
        'https://example.com/1.webp',
        'https://example.com/2.webp',
    ]);
    expect(fixture.functionIds).toEqual(['matchUrl', 'extractChapterImageUrls']);
}

async function FixtureCaptureServiceApprovedAdapterFixturesTestReplaysAnApprovedFixtureAgainstTheCurrentAdapter() {
    const root = await mkdtemp(join(tmpdir(), 'comiccrawler-fixture-'));
    roots.push(root);
    const service = new FixtureCaptureService({} as never, root);
    const adapter = new ChapterFixtureAdapter();
    const fixture = await captureChapterFixture(service, adapter,
      '<main id="reader"><img src="/1.webp"></main>');
    const manifest = fixtureManifest(fixture.id);
    const result = await service.verifyApprovedAdapterFixture(manifest, adapter);
    expect(result.passed).toBe(true);
    expect(result.actual).toEqual(result.expected);
}

async function FixtureCaptureServiceApprovedAdapterFixturesTestRejectsEmptyChapterImageOutput() {
    const root = await mkdtemp(join(tmpdir(), 'comiccrawler-fixture-'));
    roots.push(root);
    const service = new FixtureCaptureService({} as never, root);
    await expect(service.captureApprovedAdapterFixture({
        sourceDiscoveryId: 'disc-empty',
        adapter: new ChapterFixtureAdapter(),
        adapterVersion: 'v2026.10.23-fixture',
        target: 'chapter-only',
        url: 'https://example.com/chapter/1',
        html: '<main id="reader"></main>',
    })).rejects.toThrow('page is not complete');
}

function fixtureManifest(id: string) {
  return { schemaVersion: 1 as const, adapterId: 'fixture-chapter', version: 'v2026.10.23-fixture',
    name: 'Fixture Chapter', domains: ['example.com'], urlPatterns: ['https://example.com/*'],
    parseMode: 'playwright' as const,
    capabilities: { verification: false, metadata: false, chapterImages: true },
    origin: 'local-generated' as const,
    createdAt: '2026-10-23T00:00:00.000Z', approvalFixture: { id, domain: 'example.com',
      url: 'https://example.com/chapter/1', title: '', htmlLength: 1,
      capturedAt: '2026-10-23T00:00:00.000Z', adapterId: 'fixture-chapter',
      adapterVersion: 'v2026.10.23-fixture', sourceDiscoveryId: 'disc-fixture',
      functionIds: ['matchUrl', 'extractChapterImageUrls'], readiness: { status: 'ready' as const,
        target: 'chapterImages' as const, confidence: 1, reasons: [], recommendedAction: 'continue' as const } } };
}

function captureChapterFixture(service: FixtureCaptureService, adapter: ChapterFixtureAdapter,
  html: string) {
  return service.captureApprovedAdapterFixture({ sourceDiscoveryId: 'disc-fixture', adapter,
    adapterVersion: 'v2026.10.23-fixture', target: 'chapter-only',
    url: 'https://example.com/chapter/1', html });
}
