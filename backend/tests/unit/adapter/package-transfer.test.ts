import type { IStorage } from '../../../src/storage/types';
import { AdapterCatalog } from '../../../src/adapter/catalog';
import { createAdapterPackage } from '../../../src/adapter/package-builder';
import { importAdapterPackage, inspectAdapterPackage } from '../../../src/adapter/package-transfer';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { instantiateAdapterImplementationDraft } from '../../../src/selector-discovery/adapter-draft-runtime';

class MemoryStorage implements IStorage {
  readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return (this.values.get(key) as T) ?? null; }
  async write(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async list(): Promise<string[]> { return [...this.values.keys()]; }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}

describe('Adapter package transfer', () => {
  it('inspects package source without executing module code', inspectsWithoutExecution);
  it('rejects a package with modified manifest content', rejectsManifestTampering);
  it('imports packages inactive by default', importsInactiveByDefault);
  it('activates a validated imported package explicitly', activatesExplicitly);
  it('does not activate a package whose implementation identity differs', rejectsIdentityOnActivation);
});

function inspectsWithoutExecution(): void {
  const document = packageFor(`throw new TypeError('package code executed during inspection');\n${sourceFor('demo')}`);
  expect(inspectAdapterPackage(document).inspection.sourceValid).toBe(true);
}

function rejectsManifestTampering(): void {
  const document = packageFor(sourceFor('demo'));
  document.manifest.name = 'Tampered';
  expect(() => inspectAdapterPackage(document)).toThrow('manifest checksum');
}

async function importsInactiveByDefault() {
  const { catalog, registry } = await runtime();
  const result = await importAdapterPackage(catalog, registry, packageFor(sourceFor('demo')));
  expect(result.entry.activeVersion).toBeNull();
  expect(registry.has('demo')).toBe(false);
}

async function activatesExplicitly() {
  const { catalog, registry } = await runtime();
  const result = await importAdapterPackage(catalog, registry, packageFor(sourceFor('demo')), true);
  expect(result.entry.activeVersion).toBe(result.inspection.version);
  expect(registry.has('demo')).toBe(true);
}

async function rejectsIdentityOnActivation() {
  const { catalog, registry } = await runtime();
  const document = packageFor(sourceFor('other'), 'demo');
  await expect(importAdapterPackage(catalog, registry, document, true)).rejects.toThrow('identity mismatch');
  expect((await catalog.getEntry('demo'))?.activeVersion).toBeNull();
  expect(registry.has('demo')).toBe(false);
}

async function runtime() {
  const catalog = new AdapterCatalog(new MemoryStorage());
  await catalog.initialize();
  return { catalog, registry: new AdapterRegistry() };
}

function packageFor(source: string, manifestAdapterId?: string) {
  const identitySource = sourceFor(manifestAdapterId ?? 'demo');
  const adapter = instantiateAdapterImplementationDraft(identitySource);
  return createAdapterPackage({ adapter, implementationTs: source, origin: 'local-generated',
    createdAt: '2026-10-22T00:00:00.000Z' });
}

function sourceFor(adapterId: string): string {
  return `import { AdapterBase, CommonCapability, VerificationCapability, ChapterImagesCapability } from '../../base'; export class DemoAdapter extends AdapterBase {
  readonly id = '${adapterId}'; readonly name = 'Demo'; readonly domains = ['demo.invalid'];
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
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document); void sourceUrl; return $('img.page')
      .map((_, node) => $(node).attr('src') ?? '').get();
  }
}`;
}
