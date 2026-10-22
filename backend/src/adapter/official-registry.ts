import { verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fetch } from 'undici';
import { z } from 'zod';
import type {
  AdapterPackageSignature,
  AdapterRegistryPackageRecord,
  AdapterRegistryTrustEntry,
  AdapterRegistryTrustStore,
  AdapterRegistryUpdate,
  SignedAdapterPackage,
  SignedAdapterRegistryIndex,
} from '@comiccrawler/shared';
import { canonicalJson } from './canonical-json';
import type { AdapterCatalog } from './catalog';
import type { AdapterRegistry } from './registry';
import { importAdapterPackage } from './package-transfer';

const MAX_JSON_BYTES = 6_000_000;
const Checksum = z.string().regex(/^[a-f0-9]{64}$/);
const Signature = z.object({ algorithm: z.literal('ed25519'), keyId: z.string().min(1),
  value: z.string().min(1), signedAt: z.string().datetime({ offset: true }) }).strict();
const PackageRecord = z.object({ adapterId: z.string().min(1), version: z.string().min(1),
  packageUrl: z.string().url(), publishedAt: z.string().datetime({ offset: true }),
  manifestChecksum: Checksum, implementationChecksum: Checksum, keyId: z.string().min(1) }).strict();
const SignedIndex = z.object({ schemaVersion: z.literal(1), index: z.object({ schemaVersion: z.literal(1),
  id: z.string().min(1), generatedAt: z.string().datetime({ offset: true }),
  packages: z.array(PackageRecord) }).strict(), signature: Signature }).strict();
const SignedPackage = z.object({ schemaVersion: z.literal(1), document: z.unknown(),
  signature: Signature }).strict();
const TrustEntry = z.object({ id: z.string().min(1), indexUrl: z.string().url(), keyId: z.string().min(1),
  publicKeyPem: z.string().min(1), enabled: z.boolean(),
  allowedPackageOrigins: z.array(z.string().url()).optional() }).strict();
const TrustStore = z.object({ schemaVersion: z.literal(1), registries: z.array(TrustEntry) }).strict();

export type RegistryJsonFetcher = (url: string) => Promise<unknown>;

export class OfficialAdapterRegistryService {
  constructor(private readonly catalog: AdapterCatalog, private readonly registry: AdapterRegistry,
    private readonly trustStorePath: string, private readonly fetchJson: RegistryJsonFetcher = fetchRegistryJson) {}

  async list(): Promise<AdapterRegistryUpdate[]> {
    const stores = await this.loadEnabledTrustEntries();
    const groups = await Promise.all(stores.map((entry) => this.listRegistry(entry)));
    return groups.flat();
  }

  async check(adapterId?: string): Promise<AdapterRegistryUpdate[]> {
    const packages = (await this.list()).filter((item) => !adapterId || item.package.adapterId === adapterId);
    return newestPerAdapter(packages).filter((item) => !item.installed);
  }

  async install(input: RegistryInstallInput): Promise<AdapterRegistryUpdate> {
    const trust = await this.requireTrustEntry(input.registryId);
    const available = await this.listRegistry(trust);
    const selected = selectPackage(available, input.adapterId, input.version);
    await this.installSelected(trust, selected, Boolean(input.activate));
    return { ...selected, installed: true, active: Boolean(input.activate) };
  }

  async update(adapterId?: string, activate = false): Promise<AdapterRegistryUpdate[]> {
    const updates = await this.check(adapterId);
    const installed: AdapterRegistryUpdate[] = [];
    for (const update of updates) installed.push(await this.install({ registryId: update.registryId,
      adapterId: update.package.adapterId, version: update.package.version, activate }));
    return installed;
  }

  private async listRegistry(trust: AdapterRegistryTrustEntry): Promise<AdapterRegistryUpdate[]> {
    const envelope = SignedIndex.parse(await this.fetchJson(trust.indexUrl)) as SignedAdapterRegistryIndex;
    assertRegistryEnvelope(envelope, trust);
    const entries = await Promise.all(envelope.index.packages.map((record) => this.describe(trust, record)));
    return entries;
  }

  private async describe(trust: AdapterRegistryTrustEntry,
    record: AdapterRegistryPackageRecord): Promise<AdapterRegistryUpdate> {
    assertPackageOrigin(record.packageUrl, trust);
    if (record.keyId !== trust.keyId) throw new Error(`Package key "${record.keyId}" is not trusted.`);
    const entry = await this.catalog.getEntry(record.adapterId);
    return { registryId: trust.id, package: record,
      installed: Boolean(entry?.versions.some((item) => item.version === record.version)),
      active: entry?.activeVersion === record.version };
  }

  private async installSelected(trust: AdapterRegistryTrustEntry,
    selected: AdapterRegistryUpdate, activate: boolean): Promise<void> {
    const value = SignedPackage.parse(await this.fetchJson(selected.package.packageUrl)) as SignedAdapterPackage;
    assertPackageEnvelope(value, selected.package, trust);
    await importAdapterPackage(this.catalog, this.registry, value.document, activate);
  }

  private async requireTrustEntry(id?: string): Promise<AdapterRegistryTrustEntry> {
    const entries = await this.loadEnabledTrustEntries();
    const entry = id ? entries.find((item) => item.id === id) : entries.length === 1 ? entries[0] : undefined;
    if (!entry) throw new Error(id ? `Trusted registry "${id}" was not found.`
      : 'Specify registryId when more than one trusted registry is enabled.');
    return entry;
  }

  private async loadEnabledTrustEntries(): Promise<AdapterRegistryTrustEntry[]> {
    const raw = JSON.parse(await readFile(this.trustStorePath, 'utf-8')) as unknown;
    const store = TrustStore.parse(raw) as AdapterRegistryTrustStore;
    return store.registries.filter((entry) => entry.enabled);
  }
}

export interface RegistryInstallInput {
  registryId?: string;
  adapterId: string;
  version?: string;
  activate?: boolean;
}

export function signaturePayload(payload: unknown, signature: AdapterPackageSignature): string {
  return canonicalJson({ payload, algorithm: signature.algorithm,
    keyId: signature.keyId, signedAt: signature.signedAt });
}

function assertRegistryEnvelope(value: SignedAdapterRegistryIndex, trust: AdapterRegistryTrustEntry): void {
  if (value.index.id !== trust.id) throw new Error('Signed registry ID does not match the trust entry.');
  verifySignature(value.index, value.signature, trust);
}

function assertPackageEnvelope(value: SignedAdapterPackage, record: AdapterRegistryPackageRecord,
  trust: AdapterRegistryTrustEntry): void {
  verifySignature(value.document, value.signature, trust);
  const document = value.document;
  if (document.manifest.origin !== 'official') throw new Error('Signed registry packages must use official origin.');
  if (document.manifest.adapterId !== record.adapterId || document.manifest.version !== record.version)
    throw new Error('Signed package identity does not match the registry index.');
  if (document.checksums.manifest !== record.manifestChecksum
    || document.checksums.implementation !== record.implementationChecksum)
    throw new Error('Signed package checksums do not match the registry index.');
  if (record.keyId !== value.signature.keyId) throw new Error('Package signing key does not match the registry index.');
}

function verifySignature(payload: unknown, signature: AdapterPackageSignature,
  trust: AdapterRegistryTrustEntry): void {
  if (signature.keyId !== trust.keyId) throw new Error(`Signing key "${signature.keyId}" is not trusted.`);
  const bytes = Buffer.from(signaturePayload(payload, signature));
  const signatureBytes = Buffer.from(signature.value, 'base64');
  if (!verify(null, bytes, trust.publicKeyPem, signatureBytes)) throw new Error('Signature verification failed.');
}

function assertPackageOrigin(rawUrl: string, trust: AdapterRegistryTrustEntry): void {
  const origin = new URL(rawUrl).origin;
  const allowed = trust.allowedPackageOrigins ?? [new URL(trust.indexUrl).origin];
  if (!allowed.includes(origin)) throw new Error(`Package origin "${origin}" is not trusted.`);
}

function selectPackage(items: AdapterRegistryUpdate[], adapterId: string,
  version?: string): AdapterRegistryUpdate {
  const matches = items.filter((item) => item.package.adapterId === adapterId
    && (!version || item.package.version === version));
  const selected = matches.sort(comparePublished).at(-1);
  if (!selected) throw new Error(`Official adapter package ${adapterId}${version ? `@${version}` : ''} was not found.`);
  return selected;
}

function newestPerAdapter(items: AdapterRegistryUpdate[]): AdapterRegistryUpdate[] {
  const selected = new Map<string, AdapterRegistryUpdate>();
  for (const item of items) {
    const current = selected.get(item.package.adapterId);
    if (!current || comparePublished(current, item) < 0) selected.set(item.package.adapterId, item);
  }
  return [...selected.values()];
}

function comparePublished(left: AdapterRegistryUpdate, right: AdapterRegistryUpdate): number {
  return left.package.publishedAt.localeCompare(right.package.publishedAt)
    || left.package.version.localeCompare(right.package.version);
}

async function fetchRegistryJson(rawUrl: string): Promise<unknown> {
  const url = validateRegistryUrl(rawUrl);
  await assertPublicHost(url);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/json', 'User-Agent': 'ComicCrawler/0.2 adapter-registry' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}.`);
  const text = await readLimitedText(response);
  return JSON.parse(text) as unknown;
}

function validateRegistryUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Official adapter registries require HTTPS.');
  if (url.username || url.password) throw new Error('Registry URLs cannot contain credentials.');
  return url.href;
}

async function assertPublicHost(rawUrl: string): Promise<void> {
  const hostname = new URL(rawUrl).hostname;
  if (isPrivateAddress(hostname)) throw new Error(`Registry host "${hostname}" is private or reserved.`);
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error(`Registry host "${hostname}" has no DNS records.`);
  const blocked = records.find((record) => isPrivateAddress(record.address));
  if (blocked) throw new Error(`Registry host resolved to private address "${blocked.address}".`);
}

function isPrivateAddress(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  if (isIP(normalized) === 6) return normalized === '::' || /^(fc|fd|fe80)/.test(normalized);
  if (isIP(normalized) !== 4) return false;
  const [first, second] = normalized.split('.').map(Number);
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

async function readLimitedText(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks).toString('utf-8');
    size += value.byteLength;
    if (size > MAX_JSON_BYTES) throw new Error('Registry response exceeds 6 MB.');
    chunks.push(value);
  }
}
