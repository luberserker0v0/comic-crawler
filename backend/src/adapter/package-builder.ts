import type {
  AdapterPackageDocument,
  AdapterPackageFixtureSummary,
  AdapterPackageOrigin,
  AdapterPackageValidation,
  FixtureSummary,
  IComicAdapter,
} from '@comiccrawler/shared';
import { getAdapterCapabilities } from './registry';
import { createAdapterVersion, implementationChecksum, manifestChecksum } from './catalog';

interface AdapterPackageInput {
  adapter: IComicAdapter;
  implementationTs: string;
  origin: AdapterPackageOrigin;
  createdAt?: string;
  sourceDiscoveryId?: string;
  approvalFixture?: FixtureSummary;
  validation?: AdapterPackageValidation;
}

export function createAdapterPackage(input: AdapterPackageInput): AdapterPackageDocument {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const version = createAdapterVersion(createdAt, input.implementationTs);
  const validation = input.validation ?? successfulValidation();
  const optionalManifest = {
    ...(input.sourceDiscoveryId ? { sourceDiscoveryId: input.sourceDiscoveryId } : {}),
    ...(input.approvalFixture ? { approvalFixture: portableFixture(input.approvalFixture) } : {}) };
  const manifest = { schemaVersion: 1 as const, adapterId: input.adapter.id, version,
    name: input.adapter.name, domains: [...input.adapter.domains],
    urlPatterns: input.adapter.domains.map((domain) => `https://${domain}/*`),
    parseMode: input.adapter.parseMode, capabilities: getAdapterCapabilities(input.adapter),
    origin: input.origin, createdAt, ...optionalManifest };
  return {
    manifest,
    implementationTs: input.implementationTs,
    validation,
    checksums: { algorithm: 'sha256', manifest: manifestChecksum(manifest),
      implementation: implementationChecksum(input.implementationTs) },
  };
}

function successfulValidation(): AdapterPackageValidation {
  return { valid: true, syntaxValid: true, errors: [], warnings: [] };
}

function portableFixture(fixture: FixtureSummary): AdapterPackageFixtureSummary {
  if (!fixture.adapterId || !fixture.adapterVersion)
    throw new Error('Approved fixture must identify its adapter and immutable version.');
  const { path: _path, expectedPath: _expectedPath, ...portable } = fixture;
  return portable as AdapterPackageFixtureSummary;
}
