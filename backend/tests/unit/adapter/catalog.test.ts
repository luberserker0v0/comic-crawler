import type { IStorage } from '../../../src/storage/types';
import type { AdapterPackageDocument } from '@comiccrawler/shared';
import { AdapterCatalog } from '../../../src/adapter/catalog';
import { createAdapterPackage } from '../../../src/adapter/package-builder';
import { instantiateAdapterImplementationDraft } from '../../../src/selector-discovery/adapter-draft-runtime';

class MemoryStorage implements IStorage {
  readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return (this.values.get(key) as T) ?? null; }
  async write(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async list(): Promise<string[]> { return [...this.values.keys()]; }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}

describe('AdapterCatalog', () => {
  it('stores immutable approved versions and activates the latest version', storesImmutableVersions);
  it('rolls back, deactivates, and restores approved versions', rollsBackAndRestores);
  it('rejects different content for an existing immutable version', rejectsVersionMutation);
});

async function storesImmutableVersions() {
  const catalog = await createCatalog();
  const first = packageFor('img.page');
  const second = packageFor('img.reader');
  await catalog.installApproved(first);
  await catalog.installApproved(second);
  const entry = await catalog.getEntry('demo');
  expect(entry?.versions).toHaveLength(2);
  expect(entry?.activeVersion).toBe(second.manifest.version);
  expect(entry?.versions.map((item) => item.status)).toEqual(['approved', 'active']);
}

async function rollsBackAndRestores() {
  const catalog = await createCatalog();
  const first = packageFor('img.page');
  const second = packageFor('img.reader');
  await catalog.installApproved(first);
  await catalog.installApproved(second);
  expect((await catalog.rollback('demo')).activeVersion).toBe(first.manifest.version);
  expect((await catalog.deactivate('demo')).activeVersion).toBeNull();
  expect((await catalog.restore('demo')).activeVersion).toBe(first.manifest.version);
}

async function rejectsVersionMutation() {
  const catalog = await createCatalog();
  const original = packageFor('img.page');
  await catalog.installApproved(original);
  const mutated = structuredClone(original);
  mutated.validation.warnings.push('Mutated immutable package metadata.');
  await expect(catalog.installApproved(mutated)).rejects.toThrow('immutable');
}

async function createCatalog(): Promise<AdapterCatalog> {
  const catalog = new AdapterCatalog(new MemoryStorage());
  await catalog.initialize();
  return catalog;
}

function packageFor(selector: string): AdapterPackageDocument {
  const source = implementationSource(selector);
  const adapter = instantiateAdapterImplementationDraft(source);
  return createAdapterPackage({ adapter, implementationTs: source, origin: 'local-generated',
    createdAt: '2026-10-21T12:00:00.000Z', sourceDiscoveryId: `discovery-${selector}` });
}

function implementationSource(selector: string): string {
  return `import { AdapterBase, CommonCapability, VerificationCapability, ChapterImagesCapability } from '../../base';
export class DemoAdapter extends AdapterBase {
  readonly id = 'demo'; readonly name = 'Demo'; readonly domains = ['demo.invalid'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  readonly common = new DemoCommon(this); readonly verification = new DemoVerification(this);
  readonly chapterImages = new DemoImages(this);
}
class DemoCommon extends CommonCapability { matchUrl(url: string): boolean { return url.includes('demo.invalid'); } }
class DemoVerification extends VerificationCapability {
  detectVerificationRequired(_input: string): boolean { return false; }
  describeVerificationHandoff(): Record<string, unknown> { return { supported: false }; }
}
class DemoImages extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, _sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document); return $('${selector}').map((_, node) => $(node).attr('src') ?? '').get();
  }
}`;
}
