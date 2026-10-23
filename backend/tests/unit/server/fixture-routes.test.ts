import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import type { IStorage } from '../../../src/storage/types';
import { AdapterCatalog, createAdapterVersion } from '../../../src/adapter/catalog';
import { createAdapterPackage } from '../../../src/adapter/package-builder';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { instantiateAdapterImplementationDraft } from '../../../src/selector-discovery/adapter-draft-runtime';
import { FixtureCaptureService } from '../../../src/fixtures/fixture-capture-service';
import { setupFixtureRoutes } from '../../../src/server/routes/fixtures';

class MemoryStorage implements IStorage {
  private readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return (this.values.get(key) as T) ?? null; }
  async write(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async list(): Promise<string[]> { return [...this.values.keys()]; }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}

describe('Approved fixture routes', () => {
  it('reads and verifies a fixture through its immutable Adapter version', verifiesVersionFixture);
});

async function verifiesVersionFixture() {
  const fixture = await createRouteFixture();
  try {
    const base = `/api/adapters/route-fixture/versions/${fixture.version}/fixture`;
    const read = await fixture.app.inject({ method: 'GET', url: base });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.fixture.adapterVersion).toBe(fixture.version);
    const verify = await fixture.app.inject({ method: 'POST', url: `${base}/verify` });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().data.passed).toBe(true);
  } finally { await fixture.app.close(); await rm(fixture.root, { recursive: true, force: true }); }
}

async function createRouteFixture() {
  const root = await mkdtemp(join(tmpdir(), 'comiccrawler-routes-fixture-'));
  const source = adapterSource(), createdAt = '2026-10-23T00:00:00.000Z';
  const adapter = instantiateAdapterImplementationDraft(source);
  const version = createAdapterVersion(createdAt, source);
  const service = new FixtureCaptureService({} as never, root);
  const approvalFixture = await service.captureApprovedAdapterFixture({ sourceDiscoveryId: 'disc-route',
    adapter, adapterVersion: version, target: 'chapter-only', url: 'https://route.invalid/chapter/1',
    html: '<main id="reader"><img src="/1.webp"></main>' });
  const catalog = new AdapterCatalog(new MemoryStorage());
  await catalog.initialize();
  await catalog.installApproved(createAdapterPackage({ adapter, implementationTs: source,
    origin: 'local-generated', createdAt, approvalFixture }));
  const app = fastify();
  setupFixtureRoutes(app, new AdapterRegistry(), service, catalog);
  return { app, root, version };
}

function adapterSource(): string {
  return `import { AdapterBase, CommonCapability, VerificationCapability, ChapterImagesCapability } from '../../base';
export class RouteFixtureAdapter extends AdapterBase {
  readonly id = 'route-fixture'; readonly name = 'Route Fixture'; readonly domains = ['route.invalid'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  readonly common = new RouteCommon(this); readonly verification = new RouteVerification(this);
  readonly chapterImages = new RouteImages(this);
}
class RouteCommon extends CommonCapability { matchUrl(url: string): boolean { return url.includes('route.invalid'); } }
class RouteVerification extends VerificationCapability {
  detectVerificationRequired(_input: string): boolean { return false; }
  describeVerificationHandoff(): Record<string, unknown> { return { supported: false }; }
} class RouteImages extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document); return $('#reader img')
      .map((_, node) => this.adapter.resolveUrl(sourceUrl, $(node).attr('src') ?? '')).get();
  }
}`;
}
