import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import type {
  AdapterPackageDocument,
  AdapterPackageSignature,
  AdapterRegistryPackageRecord,
  SignedAdapterPackage,
  SignedAdapterRegistryIndex,
} from '@comiccrawler/shared';
import { manifestChecksum } from './catalog';
import { inspectAdapterPackage } from './package-transfer';
import { signaturePayload } from './official-registry';

export interface RegistryPublishOptions {
  registryId: string;
  baseUrl: string;
  keyId: string;
  privateKeyPem: string;
  timestamp?: string;
}

export interface AdapterRegistryRelease {
  index: SignedAdapterRegistryIndex;
  packages: Array<{ path: string; envelope: SignedAdapterPackage }>;
}

export function buildAdapterRegistryRelease(values: unknown[],
  options: RegistryPublishOptions): AdapterRegistryRelease {
  if (!values.length) throw new Error('At least one adapter package is required.');
  const timestamp = normalizeTimestamp(options.timestamp);
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  assertIdentifier(options.registryId, 'registry ID');
  assertIdentifier(options.keyId, 'key ID');
  assertEd25519PrivateKey(options.privateKeyPem);
  const packages = values.map((value) => buildPublishedPackage(value, options, timestamp));
  assertUniquePackages(packages);
  packages.sort(comparePublishedPackage);
  return { packages, index: buildSignedIndex(packages, options, baseUrl, timestamp) };
}

export function generateRegistrySigningKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

export function deriveRegistryPublicKey(privateKeyPem: string): string {
  assertEd25519PrivateKey(privateKeyPem);
  return createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
}

function buildPublishedPackage(value: unknown, options: RegistryPublishOptions,
  timestamp: string): AdapterRegistryRelease['packages'][number] {
  const source = inspectAdapterPackage(value).document;
  const document = officialDocument(source);
  inspectAdapterPackage(document);
  const signature = signPayload(document, options.keyId, options.privateKeyPem, timestamp);
  const path = `packages/${document.manifest.adapterId}/${document.manifest.version}.json`;
  return { path, envelope: { schemaVersion: 1, document, signature } };
}

function officialDocument(source: AdapterPackageDocument): AdapterPackageDocument {
  const document = structuredClone(source);
  document.manifest.origin = 'official';
  document.checksums.manifest = manifestChecksum(document.manifest);
  return document;
}

function buildSignedIndex(packages: AdapterRegistryRelease['packages'], options: RegistryPublishOptions,
  baseUrl: string, timestamp: string): SignedAdapterRegistryIndex {
  const records = packages.map((item) => packageRecord(item, baseUrl, timestamp, options.keyId));
  const index = { schemaVersion: 1 as const, id: options.registryId,
    generatedAt: timestamp, packages: records };
  return { schemaVersion: 1, index,
    signature: signPayload(index, options.keyId, options.privateKeyPem, timestamp) };
}

function packageRecord(item: AdapterRegistryRelease['packages'][number], baseUrl: string,
  timestamp: string, keyId: string): AdapterRegistryPackageRecord {
  const document = item.envelope.document;
  return { adapterId: document.manifest.adapterId, version: document.manifest.version,
    packageUrl: `${baseUrl}/${item.path}`, publishedAt: timestamp,
    manifestChecksum: document.checksums.manifest,
    implementationChecksum: document.checksums.implementation, keyId };
}

function signPayload(payload: unknown, keyId: string, privateKeyPem: string,
  signedAt: string): AdapterPackageSignature {
  const signature: AdapterPackageSignature = { algorithm: 'ed25519', keyId, value: '', signedAt };
  const bytes = Buffer.from(signaturePayload(payload, signature));
  signature.value = sign(null, bytes, privateKeyPem).toString('base64');
  return signature;
}

function assertEd25519PrivateKey(privateKeyPem: string): void {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Registry signing key must be an Ed25519 private key.');
}

function normalizeTimestamp(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf())) throw new Error('Registry timestamp is invalid.');
  return date.toISOString();
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Registry base URL must be HTTPS and cannot contain credentials.');
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

function assertUniquePackages(packages: AdapterRegistryRelease['packages']): void {
  const identities = packages.map((item) => item.path);
  if (new Set(identities).size !== identities.length) throw new Error('Duplicate adapter package version in release input.');
}

function comparePublishedPackage(left: AdapterRegistryRelease['packages'][number],
  right: AdapterRegistryRelease['packages'][number]): number {
  return left.path.localeCompare(right.path);
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`Invalid ${label}: "${value}".`);
}
