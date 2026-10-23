import { createHash } from 'node:crypto';
import type {
  AdapterCatalogEntry,
  AdapterCatalogIndex,
  AdapterCatalogVersionSummary,
  AdapterPackageDocument,
  AdapterPackageManifest,
} from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import { canonicalJson } from './canonical-json';

const INDEX_KEY = 'adapter-catalog/index';

export interface AdapterInstallOptions {
  activate?: boolean;
}

export class AdapterCatalog {
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: IStorage) {}

  async initialize(): Promise<void> {
    if (await this.storage.exists(INDEX_KEY)) return;
    await this.storage.write(INDEX_KEY, emptyIndex());
  }

  async getIndex(): Promise<AdapterCatalogIndex> {
    return (await this.storage.read<AdapterCatalogIndex>(INDEX_KEY)) ?? emptyIndex();
  }

  async listEntries(): Promise<AdapterCatalogEntry[]> {
    return Object.values((await this.getIndex()).adapters);
  }

  async getEntry(adapterId: string): Promise<AdapterCatalogEntry | undefined> {
    return (await this.getIndex()).adapters[adapterId];
  }

  async getPackage(adapterId: string, version: string): Promise<AdapterPackageDocument | null> {
    assertIdentifier(adapterId, 'adapter ID');
    assertIdentifier(version, 'adapter version');
    return this.storage.read<AdapterPackageDocument>(packageKey(adapterId, version));
  }

  async getActivePackage(adapterId: string): Promise<AdapterPackageDocument | null> {
    const entry = await this.getEntry(adapterId);
    return entry?.activeVersion ? this.getPackage(adapterId, entry.activeVersion) : null;
  }

  async getActivePackages(): Promise<AdapterPackageDocument[]> {
    const entries = (await this.listEntries()).filter((entry) => entry.activeVersion);
    const packages = await Promise.all(entries.map((entry) => this.getActivePackage(entry.adapterId)));
    const missing = packages.findIndex((item) => !item);
    if (missing >= 0) throw new Error(`Active adapter package for "${entries[missing].adapterId}" is missing.`);
    return packages as AdapterPackageDocument[];
  }

  installApproved(document: AdapterPackageDocument, options: AdapterInstallOptions = {}): Promise<AdapterCatalogEntry> {
    return this.mutate(() => this.installApprovedNow(document, options.activate ?? true));
  }

  activate(adapterId: string, version: string): Promise<AdapterCatalogEntry> {
    return this.mutate(async () => {
      if (!await this.getPackage(adapterId, version)) throw new Error(`Adapter package ${adapterId}@${version} was not found.`);
      const index = await this.getIndex();
      const entry = requireEntry(index, adapterId);
      activateEntry(entry, version);
      await this.storage.write(INDEX_KEY, index);
      return entry;
    });
  }

  rollback(adapterId: string, version?: string): Promise<AdapterCatalogEntry> {
    return this.mutate(async () => {
      const index = await this.getIndex();
      const entry = requireEntry(index, adapterId);
      const target = version ?? previousVersion(entry);
      if (!target) throw new Error(`Adapter "${adapterId}" has no previous approved version.`);
      if (!await this.getPackage(adapterId, target))
        throw new Error(`Adapter package ${adapterId}@${target} was not found.`);
      activateEntry(entry, target);
      await this.storage.write(INDEX_KEY, index);
      return entry;
    });
  }

  deactivate(adapterId: string): Promise<AdapterCatalogEntry> {
    return this.mutate(async () => {
      const index = await this.getIndex();
      const entry = requireEntry(index, adapterId);
      entry.lastActiveVersion = entry.activeVersion ?? entry.lastActiveVersion;
      entry.activeVersion = null;
      entry.deletedAt = new Date().toISOString();
      setVersionStatuses(entry);
      await this.storage.write(INDEX_KEY, index);
      return entry;
    });
  }

  restore(adapterId: string): Promise<AdapterCatalogEntry> {
    return this.mutate(async () => {
      const index = await this.getIndex();
      const entry = requireEntry(index, adapterId);
      const target = entry.lastActiveVersion ?? entry.versions.at(-1)?.version;
      if (!target) throw new Error(`Adapter "${adapterId}" has no approved version to restore.`);
      if (!await this.getPackage(adapterId, target))
        throw new Error(`Adapter package ${adapterId}@${target} was not found.`);
      activateEntry(entry, target);
      await this.storage.write(INDEX_KEY, index);
      return entry;
    });
  }

  private async installApprovedNow(document: AdapterPackageDocument, activate: boolean) {
    validateAdapterPackageDocument(document);
    await this.writeImmutablePackage(document);
    const index = await this.getIndex();
    const entry = ensureEntry(index, document);
    appendVersion(entry, document);
    if (activate) activateEntry(entry, document.manifest.version);
    await this.storage.write(INDEX_KEY, index);
    return entry;
  }

  private async writeImmutablePackage(document: AdapterPackageDocument): Promise<void> {
    const { adapterId, version } = document.manifest;
    const key = packageKey(adapterId, version);
    const existing = await this.storage.read<AdapterPackageDocument>(key);
    if (existing && canonicalJson(existing) !== canonicalJson(document)) {
      throw new Error(`Adapter package ${adapterId}@${version} is immutable and already exists.`);
    }
    if (!existing) await this.storage.write(key, document);
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function implementationChecksum(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

export function manifestChecksum(manifest: AdapterPackageManifest): string {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

export function createAdapterVersion(createdAt: string, source: string): string {
  const date = new Date(createdAt);
  const stamp = Number.isNaN(date.valueOf()) ? 'unknown' : date.toISOString().slice(0, 10).replace(/-/g, '.');
  return `v${stamp}-${implementationChecksum(source).slice(0, 8)}`;
}

export function validateAdapterPackageDocument(document: AdapterPackageDocument): void {
  const { manifest, implementationTs, checksums, validation } = document;
  assertIdentifier(manifest.adapterId, 'adapter ID');
  assertIdentifier(manifest.version, 'adapter version');
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported adapter package schema ${manifest.schemaVersion}.`);
  if (Number.isNaN(Date.parse(manifest.createdAt))) throw new Error('Adapter package createdAt is invalid.');
  if (!manifest.domains.length) throw new Error('Adapter package must declare at least one domain.');
  if (!implementationTs.trim()) throw new Error('Adapter package implementation is empty.');
  if (!validation.valid || !validation.syntaxValid) throw new Error('Adapter package validation did not pass.');
  validateApprovalFixtureIdentity(manifest);
  if (manifest.version !== createAdapterVersion(manifest.createdAt, implementationTs))
    throw new Error('Adapter package version does not match its implementation and creation time.');
  if (checksums.algorithm !== 'sha256' || checksums.implementation !== implementationChecksum(implementationTs))
    throw new Error('Adapter package implementation checksum does not match.');
  if (checksums.manifest !== manifestChecksum(manifest))
    throw new Error('Adapter package manifest checksum does not match.');
}

function validateApprovalFixtureIdentity(manifest: AdapterPackageManifest): void {
  const fixture = manifest.approvalFixture;
  if (!fixture) return;
  if (fixture.adapterId !== manifest.adapterId) throw new Error(
    `Approval fixture adapter ID does not match package "${manifest.adapterId}".`);
  if (fixture.adapterVersion !== manifest.version) throw new Error(
    `Approval fixture version does not match package "${manifest.version}".`);
}

function emptyIndex(): AdapterCatalogIndex {
  return { schemaVersion: 1, adapters: {} };
}

function ensureEntry(index: AdapterCatalogIndex, document: AdapterPackageDocument): AdapterCatalogEntry {
  const adapterId = document.manifest.adapterId;
  return index.adapters[adapterId] ??= { adapterId, activeVersion: null, versions: [] };
}

function requireEntry(index: AdapterCatalogIndex, adapterId: string): AdapterCatalogEntry {
  const entry = index.adapters[adapterId];
  if (!entry) throw new Error(`Adapter "${adapterId}" is not managed by the catalog.`);
  return entry;
}

function appendVersion(entry: AdapterCatalogEntry, document: AdapterPackageDocument): void {
  if (entry.versions.some((item) => item.version === document.manifest.version)) return;
  entry.versions.push(versionSummary(document));
}

function versionSummary(document: AdapterPackageDocument): AdapterCatalogVersionSummary {
  const manifest = document.manifest;
  return { version: manifest.version, status: 'approved', origin: manifest.origin,
    createdAt: manifest.createdAt, installedAt: new Date().toISOString(),
    ...(manifest.sourceDiscoveryId ? { sourceDiscoveryId: manifest.sourceDiscoveryId } : {}) };
}

function activateEntry(entry: AdapterCatalogEntry, version: string): void {
  if (!entry.versions.some((item) => item.version === version))
    throw new Error(`Adapter version ${entry.adapterId}@${version} was not found.`);
  entry.lastActiveVersion = entry.activeVersion ?? entry.lastActiveVersion;
  entry.activeVersion = version;
  delete entry.deletedAt;
  setVersionStatuses(entry);
}

function setVersionStatuses(entry: AdapterCatalogEntry): void {
  for (const version of entry.versions) {
    version.status = version.version === entry.activeVersion ? 'active' : 'approved';
  }
}

function previousVersion(entry: AdapterCatalogEntry): string | undefined {
  if (entry.lastActiveVersion && entry.lastActiveVersion !== entry.activeVersion) return entry.lastActiveVersion;
  return [...entry.versions].reverse().find((item) => item.version !== entry.activeVersion)?.version;
}

function packageKey(adapterId: string, version: string): string {
  return `adapter-catalog/adapters/${adapterId}/versions/${version}/package`;
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`Invalid ${label}: "${value}".`);
}
