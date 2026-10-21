import type { AdapterCapabilities, FixtureSummary, IComicAdapter } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import { instantiateAdapterImplementationDraft } from '../selector-discovery/adapter-draft-runtime';
import { AdapterCatalog } from './catalog';
import { createAdapterPackage } from './package-builder';

export const LEGACY_IMPLEMENTATIONS_KEY = 'selector-discovery-active-implementation-adapters';
export const LEGACY_MANIFESTS_KEY = 'selector-discovery-active-adapters';

interface LegacyImplementationRecord {
  adapterId: string;
  name: string;
  domains: string[];
  capabilities: AdapterCapabilities;
  sourceDiscoveryId: string;
  adapterImplementationTs: string;
  promotedAt: string;
  approvalFixture?: FixtureSummary;
}

export async function migrateLegacyAdapterStorage(
  storage: IStorage,
  catalog: AdapterCatalog
): Promise<number> {
  const records = (await storage.read<LegacyImplementationRecord[]>(LEGACY_IMPLEMENTATIONS_KEY)) ?? [];
  for (const record of records) await migrateImplementation(record, catalog);
  await removeEmptyLegacyManifests(storage);
  if (records.length > 0) await storage.delete(LEGACY_IMPLEMENTATIONS_KEY);
  return records.length;
}

async function migrateImplementation(record: LegacyImplementationRecord, catalog: AdapterCatalog): Promise<void> {
  const adapter = instantiateAdapterImplementationDraft(record.adapterImplementationTs);
  assertLegacyIdentity(record, adapter);
  const document = createAdapterPackage({ adapter, implementationTs: record.adapterImplementationTs,
    origin: 'local-generated', createdAt: record.promotedAt,
    sourceDiscoveryId: record.sourceDiscoveryId, approvalFixture: record.approvalFixture });
  await catalog.installApproved(document, true);
}

async function removeEmptyLegacyManifests(storage: IStorage): Promise<void> {
  const manifests = (await storage.read<unknown[]>(LEGACY_MANIFESTS_KEY)) ?? [];
  if (manifests.length > 0) throw new Error(
    'Legacy selector-manifest adapters must be converted before Adapter Catalog migration.');
  if (await storage.exists(LEGACY_MANIFESTS_KEY)) await storage.delete(LEGACY_MANIFESTS_KEY);
}

function assertLegacyIdentity(record: LegacyImplementationRecord, adapter: IComicAdapter): void {
  if (adapter.id !== record.adapterId) throw new Error(
    `Legacy adapter identity mismatch: expected "${record.adapterId}", got "${adapter.id}".`);
}
