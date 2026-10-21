import type { FixtureSummary } from './api';
import type { AdapterCapabilities } from './adapter';

export type AdapterPackageOrigin = 'bundled' | 'local-generated' | 'imported' | 'official';
export type AdapterVersionStatus = 'approved' | 'active';

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
  approvalFixture?: FixtureSummary;
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
