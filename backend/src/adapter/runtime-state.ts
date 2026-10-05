import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { IComicAdapter } from '@comiccrawler/shared';
import { DynamicSiteAdapter, type DynamicSiteAdapterManifest } from './dynamic-site-adapter';
import type { ActiveImplementationAdapterRecord } from '../selector-discovery/service';
import type { IStorage } from '../storage/types';

export const PROJECT_ADAPTER_SOURCE: Record<string, string> = {
  kuronavi: 'backend/src/adapter/sites/kuronavi/adapter.ts',
  happymh: 'backend/src/adapter/sites/happymh/adapter.ts',
};

const PROJECT_ADAPTER_LOADERS: Record<string, () => Promise<{ adapter: IComicAdapter }>> = {
  kuronavi: () => loadProjectAdapterModule('kuronavi', 'KuronaviAdapter'),
  happymh: () => loadProjectAdapterModule('happymh', 'HappyMhAdapter'),
};

export const DELETED_ADAPTERS_KEY = 'adapters-deleted';
export const ACTIVE_DYNAMIC_ADAPTERS_KEY = 'selector-discovery-active-adapters';
export const ACTIVE_IMPLEMENTATION_ADAPTERS_KEY = 'selector-discovery-active-implementation-adapters';

export type AdapterImplementationKind = 'project-source' | 'selector-manifest' | 'ts-implementation' | 'summary' | 'generated-draft';
export type AdapterDraftSourceKind = 'project-source' | 'dynamic-manifest' | 'generated-draft';

export interface DeletedAdapterRecord {
  adapterId: string;
  deletedAt: string;
  implementationKind?: AdapterImplementationKind;
  sourcePath?: string;
  sourceDirectory?: string;
  sourceDeleted?: boolean;
  activeManifest?: DynamicSiteAdapterManifest;
  activeImplementationRecord?: ActiveImplementationAdapterRecord;
}

export async function readDeletedAdapterRecords(storage: IStorage): Promise<DeletedAdapterRecord[]> {
  return (await storage.read<DeletedAdapterRecord[]>(DELETED_ADAPTERS_KEY)) ?? [];
}

export async function readDeletedAdapterIds(storage: IStorage): Promise<Set<string>> {
  const records = await readDeletedAdapterRecords(storage);
  return new Set(records.map((record) => record.adapterId));
}

export async function markAdapterDeleted(
  storage: IStorage,
  adapterId: string,
  details: Omit<DeletedAdapterRecord, 'adapterId' | 'deletedAt'> = {}
): Promise<DeletedAdapterRecord> {
  const records = await readDeletedAdapterRecords(storage);
  const record: DeletedAdapterRecord = {
    adapterId,
    deletedAt: new Date().toISOString(),
    ...details,
  };
  await storage.write(DELETED_ADAPTERS_KEY, [
    ...records.filter((record) => record.adapterId !== adapterId),
    record,
  ]);
  return record;
}

export async function removeDeletedAdapterRecord(storage: IStorage, adapterId: string): Promise<void> {
  const records = await readDeletedAdapterRecords(storage);
  await storage.write(DELETED_ADAPTERS_KEY, records.filter((record) => record.adapterId !== adapterId));
}

export async function registerProjectAdapters(
  storage: IStorage,
  register: (adapter: IComicAdapter) => void,
  adapters?: IComicAdapter[]
): Promise<void> {
  const deletedAdapterIds = await readDeletedAdapterIds(storage);
  if (adapters) {
    for (const adapter of adapters) {
      if (!deletedAdapterIds.has(adapter.id)) {
        register(adapter);
      }
    }
    return;
  }

  for (const adapterId of Object.keys(PROJECT_ADAPTER_SOURCE)) {
    if (deletedAdapterIds.has(adapterId) || !projectAdapterSourceExists(adapterId)) {
      continue;
    }
    const loader = PROJECT_ADAPTER_LOADERS[adapterId];
    if (!loader) continue;
    const { adapter } = await loader();
    if (!deletedAdapterIds.has(adapter.id)) {
      register(adapter);
    }
  }
}

export async function deleteProjectAdapterSource(adapterId: string): Promise<{ deleted: boolean; sourceDir?: string }> {
  const sourceDir = resolveProjectAdapterSourceDir(adapterId);
  if (!sourceDir) {
    return { deleted: false };
  }
  if (!isProjectAdapterSourceDir(sourceDir)) {
    throw new Error(`Refusing to delete adapter source outside project adapter directory: ${sourceDir}`);
  }
  if (!existsSync(sourceDir)) {
    return { deleted: false, sourceDir };
  }
  await rm(sourceDir, { recursive: true, force: true });
  return { deleted: true, sourceDir };
}

export function projectAdapterSourceExists(adapterId: string): boolean {
  const relativePath = PROJECT_ADAPTER_SOURCE[adapterId];
  return Boolean(relativePath && resolveProjectPathCandidates(relativePath).some((candidate) => existsSync(candidate)));
}

export function resolveProjectAdapterSourceDir(adapterId: string): string | undefined {
  const relativePath = PROJECT_ADAPTER_SOURCE[adapterId];
  if (!relativePath) return undefined;
  const sourceFile = resolveProjectPathCandidates(relativePath).find((candidate) => existsSync(candidate))
    ?? resolveProjectPathCandidates(relativePath)[0];
  return sourceFile ? dirname(sourceFile) : undefined;
}

export async function restoreDeletedAdapter(
  storage: IStorage,
  adapterId: string,
  register: (adapter: IComicAdapter) => void
): Promise<{
  restored: boolean;
  record?: DeletedAdapterRecord;
  reason?: string;
}> {
  const record = (await readDeletedAdapterRecords(storage)).find((item) => item.adapterId === adapterId);
  if (!record) {
    return { restored: false, reason: 'Deleted adapter record was not found.' };
  }

  if (record.activeManifest) {
    const manifests = (await storage.read<DynamicSiteAdapterManifest[]>(ACTIVE_DYNAMIC_ADAPTERS_KEY)) ?? [];
    await storage.write(ACTIVE_DYNAMIC_ADAPTERS_KEY, [
      ...manifests.filter((item) => item.adapterId !== adapterId),
      record.activeManifest,
    ]);
    register(new DynamicSiteAdapter(record.activeManifest));
    await removeDeletedAdapterRecord(storage, adapterId);
    return { restored: true, record };
  }

  if (record.activeImplementationRecord) {
    const implementationRecords = (await storage.read<ActiveImplementationAdapterRecord[]>(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY)) ?? [];
    await storage.write(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY, [
      ...implementationRecords.filter((item) => item.adapterId !== adapterId),
      record.activeImplementationRecord,
    ]);
    const { instantiateAdapterImplementationDraft } = await import('../selector-discovery/adapter-draft-runtime');
    register(instantiateAdapterImplementationDraft(record.activeImplementationRecord.adapterImplementationTs));
    await removeDeletedAdapterRecord(storage, adapterId);
    return { restored: true, record };
  }

  if (PROJECT_ADAPTER_SOURCE[adapterId]) {
    if (!projectAdapterSourceExists(adapterId)) {
      return {
        restored: false,
        record,
        reason: 'Project TypeScript source is missing. Restore the source directory with git before restoring this adapter.',
      };
    }
    await removeDeletedAdapterRecord(storage, adapterId);
    const { adapter } = await loadProjectAdapterModule(adapterId, PROJECT_ADAPTER_CLASS_NAMES[adapterId] ?? '');
    register(adapter);
    return { restored: true, record };
  }

  return {
    restored: false,
    record,
    reason: 'No restorable runtime manifest, TypeScript implementation, or project source is available.',
  };
}

function resolveProjectPathCandidates(relativePath: string): string[] {
  const overrideRoot = process.env.COMICCRAWLER_PROJECT_SOURCE_ROOT;
  if (overrideRoot) {
    return [resolve(overrideRoot, relativePath)];
  }
  return [
    resolve(process.cwd(), relativePath),
    resolve(process.cwd(), '..', relativePath),
  ];
}

function isProjectAdapterSourceDir(sourceDir: string): boolean {
  const normalized = resolve(sourceDir);
  const overrideRoot = process.env.COMICCRAWLER_PROJECT_SOURCE_ROOT;
  const roots = overrideRoot ? [resolve(overrideRoot, 'backend', 'src', 'adapter', 'sites')] : [
    resolve(process.cwd(), 'backend', 'src', 'adapter', 'sites'),
    resolve(process.cwd(), '..', 'backend', 'src', 'adapter', 'sites'),
  ];
  return roots.some((sitesRoot) => normalized.startsWith(`${sitesRoot}\\`) || normalized.startsWith(`${sitesRoot}/`));
}

async function loadProjectAdapterModule(adapterId: string, className: string): Promise<{ adapter: IComicAdapter }> {
  const modulePath = `./sites/${adapterId}`;
  const module = await import(modulePath) as Record<string, unknown>;
  const AdapterClass = module[className];
  if (typeof AdapterClass !== 'function') {
    throw new Error(`Project adapter module "${modulePath}" does not export ${className}.`);
  }
  return { adapter: new (AdapterClass as new () => IComicAdapter)() };
}

const PROJECT_ADAPTER_CLASS_NAMES: Record<string, string> = {
  kuronavi: 'KuronaviAdapter',
  happymh: 'HappyMhAdapter',
};
