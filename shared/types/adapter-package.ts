import type { FixtureSummary } from './api';
import type { AdapterCapabilities } from './adapter';

export type AdapterPackageOrigin = 'bundled' | 'local-generated' | 'imported' | 'official';
export type AdapterVersionStatus = 'approved' | 'active';
export type AdapterPackageFixtureSummary = Omit<FixtureSummary,
  'path' | 'expectedPath' | 'adapterId' | 'adapterVersion'> & {
    adapterId: string;
    adapterVersion: string;
  };

export interface AdapterPackageManifest {
  schemaVersion: 1;
  adapterId: string;
  version: string;
  name: string;
  domains: string[];
  urlPatterns: string[];
  parseMode: 'playwright';
  capabilities: AdapterCapabilities;
  origin: AdapterPackageOrigin;
  createdAt: string;
  sourceDiscoveryId?: string;
  approvalFixture?: AdapterPackageFixtureSummary;
}

export interface AdapterPackageValidation {
  valid: boolean;
  syntaxValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AdapterPackageChecksums {
  algorithm: 'sha256';
  manifest: string;
  implementation: string;
}

export interface AdapterPackageDocument {
  manifest: AdapterPackageManifest;
  implementationTs: string;
  validation: AdapterPackageValidation;
  checksums: AdapterPackageChecksums;
}

export interface AdapterCatalogVersionSummary {
  version: string;
  status: AdapterVersionStatus;
  origin: AdapterPackageOrigin;
  createdAt: string;
  installedAt: string;
  sourceDiscoveryId?: string;
}

export interface AdapterCatalogEntry {
  adapterId: string;
  activeVersion: string | null;
  lastActiveVersion?: string;
  versions: AdapterCatalogVersionSummary[];
  deletedAt?: string;
}

export interface AdapterCatalogIndex {
  schemaVersion: 1;
  adapters: Record<string, AdapterCatalogEntry>;
}

export interface AdapterPackageInspection {
  adapterId: string;
  version: string;
  name: string;
  domains: string[];
  capabilities: AdapterCapabilities;
  origin: AdapterPackageOrigin;
  sourceValid: boolean;
  warnings: string[];
}

export interface AdapterPackageImportRequest {
  document: AdapterPackageDocument;
  activate?: boolean;
}

export interface AdapterPackageImportResponse {
  entry: AdapterCatalogEntry;
  inspection: AdapterPackageInspection;
  activated: boolean;
}

export interface AdapterPackageSignature {
  algorithm: 'ed25519';
  keyId: string;
  value: string;
  signedAt: string;
}

export interface SignedAdapterPackage {
  schemaVersion: 1;
  document: AdapterPackageDocument;
  signature: AdapterPackageSignature;
}

export interface AdapterRegistryPackageRecord {
  adapterId: string;
  version: string;
  packageUrl: string;
  publishedAt: string;
  manifestChecksum: string;
  implementationChecksum: string;
  keyId: string;
}

export interface AdapterRegistryIndex {
  schemaVersion: 1;
  id: string;
  generatedAt: string;
  packages: AdapterRegistryPackageRecord[];
}

export interface SignedAdapterRegistryIndex {
  schemaVersion: 1;
  index: AdapterRegistryIndex;
  signature: AdapterPackageSignature;
}

export interface AdapterRegistryTrustEntry {
  id: string;
  indexUrl: string;
  keyId: string;
  publicKeyPem: string;
  enabled: boolean;
  allowedPackageOrigins?: string[];
}

export interface AdapterRegistryTrustStore {
  schemaVersion: 1;
  registries: AdapterRegistryTrustEntry[];
}

export interface AdapterRegistryUpdate {
  registryId: string;
  package: AdapterRegistryPackageRecord;
  installed: boolean;
  active: boolean;
}
