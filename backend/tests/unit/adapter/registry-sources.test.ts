import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { instantiateCatalogPackage } from '../../../src/adapter/catalog-runtime';
import { inspectAdapterPackage } from '../../../src/adapter/package-transfer';
import {
  buildAdapterRegistryRelease,
  generateRegistrySigningKeyPair,
} from '../../../src/adapter/registry-publisher';

const PACKAGE_DIRECTORY = resolve(__dirname, '../../../../registry/packages');

describe('official adapter registry sources', () => {
  it('keeps every checked-in package portable and valid', validatesRegistrySources);
  it('builds a signed release from every checked-in package', buildsRegistryRelease);
});

async function validatesRegistrySources() {
  const values = await readRegistrySources();
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    const { document } = inspectAdapterPackage(value);
    const adapter = instantiateCatalogPackage(document);
    expect(adapter.id).toBe(document.manifest.adapterId);
  }
}

async function buildsRegistryRelease() {
  const { privateKeyPem } = generateRegistrySigningKeyPair();
  const release = buildAdapterRegistryRelease(await readRegistrySources(), {
    registryId: 'official', baseUrl: 'https://registry.example',
    keyId: 'test-key', privateKeyPem, timestamp: '2026-10-22T00:00:00.000Z',
  });
  expect(release.packages.length).toBeGreaterThan(0);
  expect(release.index.index.packages).toHaveLength(release.packages.length);
}

async function readRegistrySources(): Promise<unknown[]> {
  const files = (await readdir(PACKAGE_DIRECTORY)).filter((file) => file.endsWith('.ccadapter.json'));
  return Promise.all(files.map(async (file) =>
    JSON.parse(await readFile(join(PACKAGE_DIRECTORY, file), 'utf-8')) as unknown));
}
