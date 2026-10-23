import { z } from 'zod';
import type { AdapterCatalogEntry, AdapterPackageDocument, AdapterPackageInspection } from '@comiccrawler/shared';
import { validateAdapterImplementationDraft } from '../selector-discovery/adapter-implementation';
import { AdapterCatalog, validateAdapterPackageDocument } from './catalog';
import { instantiateCatalogPackage } from './catalog-runtime';
import type { AdapterRegistry } from './registry';

const Identifier = z.string().regex(/^[A-Za-z0-9._-]+$/);
const Checksum = z.string().regex(/^[a-f0-9]{64}$/);
const Capabilities = z.object({ verification: z.boolean(), metadata: z.boolean(),
  chapterImages: z.boolean() }).strict();
const Readiness = z.object({
  status: z.enum(['ready', 'human_verification_required', 'needs_fixture_or_manual_review', 'failed']),
  target: z.enum(['metadata', 'chapterImages', 'verification', 'common']), confidence: z.number(),
  reasons: z.array(z.string()), recommendedAction: z.enum(['continue', 'human_verification_handoff',
    'capture_verified_fixture', 'manual_review']),
}).strict();
const Fixture = z.object({ id: z.string(), domain: z.string(), url: z.string(), title: z.string(),
  htmlLength: z.number().int().nonnegative(), capturedAt: z.string(), adapterId: Identifier,
  adapterVersion: Identifier,
  sourceDiscoveryId: z.string().optional(), functionIds: z.array(z.string()).optional(),
  readiness: Readiness }).strict();
const Manifest = z.object({ schemaVersion: z.literal(1), adapterId: Identifier, version: Identifier,
  name: z.string().min(1), domains: z.array(z.string().min(1)).min(1),
  urlPatterns: z.array(z.string().min(1)), parseMode: z.literal('playwright'),
  capabilities: Capabilities, origin: z.enum(['bundled', 'local-generated', 'imported', 'official']),
  createdAt: z.string().datetime({ offset: true }), sourceDiscoveryId: z.string().optional(),
  approvalFixture: Fixture.optional() }).strict();
const Validation = z.object({ valid: z.boolean(), syntaxValid: z.boolean(),
  errors: z.array(z.string()), warnings: z.array(z.string()) }).strict();
const PackageDocument = z.object({ manifest: Manifest, implementationTs: z.string().min(1).max(5_000_000),
  validation: Validation, checksums: z.object({ algorithm: z.literal('sha256'),
    manifest: Checksum, implementation: Checksum }).strict() }).strict();

export function inspectAdapterPackage(value: unknown): {
  document: AdapterPackageDocument;
  inspection: AdapterPackageInspection;
} {
  const document = PackageDocument.parse(value) as AdapterPackageDocument;
  validateAdapterPackageDocument(document);
  const sourceValidation = validateAdapterImplementationDraft(document.implementationTs,
    { target: document.manifest.capabilities.metadata ? 'full' : 'chapter-only' });
  if (!sourceValidation.valid) throw new Error(sourceValidation.errors.join(' '));
  return { document, inspection: createInspection(document, sourceValidation.warnings) };
}

export async function importAdapterPackage(
  catalog: AdapterCatalog, registry: AdapterRegistry, value: unknown, activate = false
): Promise<{ entry: AdapterCatalogEntry; inspection: AdapterPackageInspection }> {
  const { document, inspection } = inspectAdapterPackage(value);
  let entry = await catalog.installApproved(document, { activate: false });
  if (activate) entry = await activateAdapterPackage(catalog, registry,
    document.manifest.adapterId, document.manifest.version);
  return { entry, inspection };
}

export async function activateAdapterPackage(
  catalog: AdapterCatalog, registry: AdapterRegistry, adapterId: string, version: string
): Promise<AdapterCatalogEntry> {
  const document = await catalog.getPackage(adapterId, version);
  if (!document) throw new Error(`Adapter package ${adapterId}@${version} was not found.`);
  const adapter = instantiateCatalogPackage(document);
  assertNoDomainConflict(registry, adapter.id, adapter.domains);
  const entry = await catalog.activate(adapterId, version);
  if (registry.has(adapter.id)) registry.replace(adapter); else registry.register(adapter);
  return entry;
}

function createInspection(document: AdapterPackageDocument, warnings: string[]): AdapterPackageInspection {
  const manifest = document.manifest;
  return { adapterId: manifest.adapterId, version: manifest.version, name: manifest.name,
    domains: [...manifest.domains], capabilities: manifest.capabilities, origin: manifest.origin,
    sourceValid: true, warnings };
}

function assertNoDomainConflict(registry: AdapterRegistry, adapterId: string, domains: string[]): void {
  const conflict = registry.getAll().find((item) => item.id !== adapterId
    && item.domains.some((domain) => domains.includes(domain)));
  if (conflict) throw new Error(`Adapter "${adapterId}" conflicts with "${conflict.id}".`);
}
