import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IStorage } from '../../../src/storage/types';
import { AdapterCatalog } from '../../../src/adapter/catalog';
import { createAdapterPackage } from '../../../src/adapter/package-builder';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { ComicCrawlerCli } from '../../../src/cli';
import { instantiateAdapterImplementationDraft } from '../../../src/selector-discovery/adapter-draft-runtime';
import { PROJECT_ADAPTER_SOURCE } from '../../../src/adapter/runtime-state';

class MemoryStorage implements IStorage {
  readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return (this.values.get(key) as T) ?? null; }
  async write(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async list(): Promise<string[]> { return [...this.values.keys()]; }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}

describe('adapter-packages CLI', () => {
  it('exports and imports an inactive portable package', exportsAndImportsPackage);
  it('builds a portable package from project source', buildsProjectPackage);
  it('generates keys and publishes a signed static registry', publishesSignedRegistry);
});

async function buildsProjectPackage() {
  const directory = await mkdtemp(join(tmpdir(), 'comiccrawler-project-package-'));
  const sourcePath = join(directory, 'adapter.ts');
  const output = join(directory, 'demo.ccadapter.json');
  await writeFile(sourcePath, adapterSource(), 'utf-8');
  PROJECT_ADAPTER_SOURCE.demo = sourcePath;
  const { cli } = await createRuntime();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  await cli.parse(['node', 'comiccrawler', 'adapter-packages', 'build-project', 'demo',
    '--created-at', '2026-10-22T00:00:00.000Z', '--output', output]);
  const document = JSON.parse(await readFile(output, 'utf-8'));
  expect(document.manifest).toMatchObject({ adapterId: 'demo', origin: 'bundled' });
  expect(instantiateAdapterImplementationDraft(document.implementationTs).id).toBe('demo');
  delete PROJECT_ADAPTER_SOURCE.demo;
  jest.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
}

async function exportsAndImportsPackage() {
  const directory = await mkdtemp(join(tmpdir(), 'comiccrawler-package-cli-'));
  const output = join(directory, 'demo.ccadapter.json');
  const sourceRuntime = await createRuntime();
  const document = packageDocument();
  await sourceRuntime.catalog.installApproved(document);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  await sourceRuntime.cli.parse(['node', 'comiccrawler', 'adapter-packages', 'export', 'demo', '-o', output]);
  expect(JSON.parse(await readFile(output, 'utf-8'))).toEqual(document);
  const targetRuntime = await createRuntime();
  await targetRuntime.cli.parse(['node', 'comiccrawler', 'adapter-packages', 'import', output]);
  expect((await targetRuntime.catalog.getEntry('demo'))?.activeVersion).toBeNull();
  jest.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
}

async function publishesSignedRegistry() {
  const directory = await mkdtemp(join(tmpdir(), 'comiccrawler-publish-cli-'));
  const input = join(directory, 'demo.ccadapter.json');
  const privateKey = join(directory, 'private.pem');
  const publicKey = join(directory, 'public.pem');
  const output = join(directory, 'release');
  await writeFile(input, JSON.stringify(packageDocument()), 'utf-8');
  const { cli } = await createRuntime();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  await cli.parse(['node', 'comiccrawler', 'adapter-registry', 'keygen',
    '--private-key', privateKey, '--public-key', publicKey]);
  await cli.parse(publishArgs(input, output, privateKey));
  const derivedKey = join(output, 'public-key.pem');
  await cli.parse(publicKeyArgs(privateKey, derivedKey));
  const index = JSON.parse(await readFile(join(output, 'index.json'), 'utf-8'));
  expect(index.index.packages).toHaveLength(1);
  expect(await readFile(derivedKey, 'utf-8')).toBe(await readFile(publicKey, 'utf-8'));
  jest.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
}

function publicKeyArgs(privateKey: string, output: string): string[] {
  return ['node', 'comiccrawler', 'adapter-registry', 'public-key',
    '--private-key', privateKey, '--output', output];
}

function publishArgs(input: string, output: string, privateKey: string): string[] {
  return ['node', 'comiccrawler', 'adapter-registry', 'publish', input,
    '--output', output, '--registry-id', 'official', '--base-url', 'https://registry.example',
    '--key-id', 'release-2026', '--private-key', privateKey,
    '--timestamp', '2026-10-22T12:00:00.000Z'];
}

async function createRuntime() {
  const storage = new MemoryStorage();
  const catalog = new AdapterCatalog(storage);
  const registry = new AdapterRegistry();
  await catalog.initialize();
  const options = { adapterCatalog: catalog, adapterRegistry: registry, storage,
    configManager: {} as any, taskManager: {} as any, crawlerEngine: {} as any,
    agentAdminService: {} as any };
  return { catalog, registry, cli: new ComicCrawlerCli(options) };
}

function packageDocument() {
  const source = adapterSource();
  const adapter = instantiateAdapterImplementationDraft(source);
  return createAdapterPackage({ adapter, implementationTs: source,
    origin: 'local-generated', createdAt: '2026-10-22T00:00:00.000Z' });
}

function adapterSource(): string {
  return `import { AdapterBase, CommonCapability, VerificationCapability, ReaderPreparationCapability, ChapterImagesCapability } from '../../base'; export class DemoAdapter extends AdapterBase {
  readonly id = 'demo'; readonly name = 'Demo'; readonly domains = ['demo.invalid'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  readonly common = new DemoCommon(this); readonly verification = new DemoVerification(this);
  readonly readerPreparation = new DemoReader(this); readonly chapterImages = new DemoImages(this);
}
class DemoCommon extends CommonCapability { matchUrl(url: string): boolean { return url.includes('demo.invalid'); } }
class DemoVerification extends VerificationCapability { detectVerificationRequired(_input: string): boolean { return false; } }
class DemoReader extends ReaderPreparationCapability { getReaderContainerSelector(): string { return 'main'; }
  getReaderPageSelector(): string { return 'img.page'; } }
class DemoImages extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document); void sourceUrl; return $('img.page')
      .map((_, node) => $(node).attr('src') ?? '').get();
  }
}`;
}
