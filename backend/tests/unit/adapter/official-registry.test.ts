import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AdapterPackageDocument } from '@comiccrawler/shared';
import type { IStorage } from '../../../src/storage/types';
import { AdapterCatalog } from '../../../src/adapter/catalog';
import { createAdapterPackage } from '../../../src/adapter/package-builder';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { OfficialAdapterRegistryService } from '../../../src/adapter/official-registry';
import { buildAdapterRegistryRelease } from '../../../src/adapter/registry-publisher';
import { instantiateAdapterImplementationDraft } from '../../../src/selector-discovery/adapter-draft-runtime';

class MemoryStorage implements IStorage {
  readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return (this.values.get(key) as T) ?? null; }
  async write(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async list(): Promise<string[]> { return [...this.values.keys()]; }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}

describe('OfficialAdapterRegistryService', () => {
  it('verifies and installs an official package inactive', installsVerifiedPackage);
  it('rejects a registry index modified after signing', rejectsTamperedIndex);
  it('rejects a package modified after signing', rejectsTamperedPackage);
});

async function installsVerifiedPackage() {
  const fixture = await registryFixture();
  const updates = await fixture.service.check('demo');
  expect(updates).toHaveLength(1);
  const installed = await fixture.service.install({ adapterId: 'demo' });
  expect(installed.installed).toBe(true);
  expect((await fixture.catalog.getEntry('demo'))?.activeVersion).toBeNull();
}

async function rejectsTamperedIndex() {
  const fixture = await registryFixture();
  fixture.index.index.id = 'tampered';
  await expect(fixture.service.list()).rejects.toThrow('registry ID');
}

async function rejectsTamperedPackage() {
  const fixture = await registryFixture();
  fixture.envelope.document.implementationTs += '\n// tampered';
  await expect(fixture.service.install({ adapterId: 'demo' })).rejects.toThrow('Signature verification');
}

async function registryFixture() {
  const keys = generateKeyPairSync('ed25519');
  const document = packageDocument();
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const release = buildAdapterRegistryRelease([document], { registryId: 'official',
    baseUrl: 'https://registry.test', keyId: 'release-2026', privateKeyPem,
    timestamp: '2026-10-22T00:00:00.000Z' });
  const index = release.index;
  const envelope = release.packages[0].envelope;
  const trustPath = await writeTrustStore(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  const values = new Map<string, unknown>([['https://registry.test/index.json', index],
    [index.index.packages[0].packageUrl, envelope]]);
  const catalog = new AdapterCatalog(new MemoryStorage());
  await catalog.initialize();
  const service = new OfficialAdapterRegistryService(catalog, new AdapterRegistry(), trustPath,
    async (url) => structuredClone(values.get(url)));
  return { service, catalog, index, envelope };
}

async function writeTrustStore(publicKeyPem: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'comiccrawler-registry-'));
  const path = join(directory, 'trust.json');
  const value = { schemaVersion: 1, registries: [{ id: 'official',
    indexUrl: 'https://registry.test/index.json', keyId: 'release-2026', publicKeyPem, enabled: true }] };
  await writeFile(path, JSON.stringify(value), 'utf-8');
  return path;
}

function packageDocument(): AdapterPackageDocument {
  const source = adapterSource();
  const adapter = instantiateAdapterImplementationDraft(source);
  return createAdapterPackage({ adapter, implementationTs: source, origin: 'official',
    createdAt: '2026-10-22T00:00:00.000Z' });
}

function adapterSource(): string {
  return `import { AdapterBase, CommonCapability, VerificationCapability, ReaderPreparationCapability, ChapterImagesCapability } from '../../base';
export class DemoAdapter extends AdapterBase { readonly id = 'demo'; readonly name = 'Demo';
readonly domains = ['demo.invalid']; readonly parseMode = 'playwright' as const;
readonly capabilities = { verification: true, metadata: false, chapterImages: true };
readonly common = new DemoCommon(this); readonly verification = new DemoVerification(this);
readonly readerPreparation = new DemoReader(this); readonly chapterImages = new DemoImages(this); }
class DemoCommon extends CommonCapability { matchUrl(url: string): boolean { return url.includes('demo.invalid'); } }
class DemoVerification extends VerificationCapability { detectVerificationRequired(): boolean { return false; } }
class DemoReader extends ReaderPreparationCapability { getReaderContainerSelector(): string { return 'main'; }
getReaderPageSelector(): string { return 'img.page'; } }
class DemoImages extends ChapterImagesCapability {
extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
void document; void sourceUrl; return []; } }`;
}
