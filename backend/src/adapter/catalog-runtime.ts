import type { AdapterPackageDocument, IComicAdapter } from '@comiccrawler/shared';
import { instantiateAdapterImplementationDraft } from '../selector-discovery/adapter-draft-runtime';
import { AdapterCatalog } from './catalog';
import type { AdapterRegistry } from './registry';

export async function loadCatalogAdapters(
  catalog: AdapterCatalog,
  registry: AdapterRegistry
): Promise<IComicAdapter[]> {
  const packages = await catalog.getActivePackages();
  return packages.map((document) => registerPackage(document, registry));
}

export function instantiateCatalogPackage(document: AdapterPackageDocument): IComicAdapter {
  const adapter = instantiateAdapterImplementationDraft(document.implementationTs);
  assertPackageIdentity(document, adapter);
  return adapter;
}

function registerPackage(document: AdapterPackageDocument, registry: AdapterRegistry): IComicAdapter {
  const adapter = instantiateCatalogPackage(document);
  const conflict = registry.getAll().find((item) => item.id !== adapter.id
    && item.domains.some((domain) => adapter.domains.includes(domain)));
  if (conflict) throw new Error(`Catalog adapter "${adapter.id}" conflicts with "${conflict.id}".`);
  if (registry.has(adapter.id)) registry.replace(adapter);
  else registry.register(adapter);
  return adapter;
}

function assertPackageIdentity(document: AdapterPackageDocument, adapter: IComicAdapter): void {
  const manifest = document.manifest;
  if (adapter.id !== manifest.adapterId) throw new Error(
    `Adapter package identity mismatch: expected "${manifest.adapterId}", got "${adapter.id}".`);
  if (adapter.parseMode !== manifest.parseMode) throw new Error(
    `Adapter package parse mode mismatch for "${adapter.id}".`);
  if (JSON.stringify(adapter.domains) !== JSON.stringify(manifest.domains)) throw new Error(
    `Adapter package domains do not match implementation for "${adapter.id}".`);
}
