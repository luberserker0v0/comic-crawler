import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import type { AdapterPackageSignature } from '@comiccrawler/shared';
import { createAdapterPackage } from '../../../src/adapter/package-builder';
import { buildAdapterRegistryRelease, deriveRegistryPublicKey,
  generateRegistrySigningKeyPair } from '../../../src/adapter/registry-publisher';
import { signaturePayload } from '../../../src/adapter/official-registry';
import { instantiateAdapterImplementationDraft } from '../../../src/selector-discovery/adapter-draft-runtime';

describe('adapter registry publisher', () => {
  it('builds deterministic signed official artifacts', buildsSignedArtifacts);
  it('rejects duplicate package identities', rejectsDuplicates);
  it('rejects non-Ed25519 signing keys', rejectsWrongKeyType);
  it('generates an Ed25519 key pair', generatesKeyPair);
});

function buildsSignedArtifacts() {
  const keys = generateRegistrySigningKeyPair();
  const options = publishOptions(keys.privateKeyPem);
  const first = buildAdapterRegistryRelease([packageDocument()], options);
  const second = buildAdapterRegistryRelease([packageDocument()], options);
  expect(first).toEqual(second);
  expect(first.packages[0].envelope.document.manifest.origin).toBe('official');
  expect(first.index.index.packages[0].packageUrl).toContain('/packages/demo/');
  expect(validSignature(first.index.index, first.index.signature, keys.publicKeyPem)).toBe(true);
  const published = first.packages[0].envelope;
  expect(validSignature(published.document, published.signature, keys.publicKeyPem)).toBe(true);
  expect(JSON.stringify(first)).not.toContain(keys.privateKeyPem);
}

function rejectsDuplicates() {
  const keys = generateRegistrySigningKeyPair();
  const document = packageDocument();
  expect(() => buildAdapterRegistryRelease([document, document], publishOptions(keys.privateKeyPem)))
    .toThrow('Duplicate adapter package');
}

function rejectsWrongKeyType() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  expect(() => buildAdapterRegistryRelease([packageDocument()], publishOptions(privateKeyPem)))
    .toThrow('Ed25519');
}

function generatesKeyPair() {
  const keys = generateRegistrySigningKeyPair();
  expect(createPrivateKey(keys.privateKeyPem).asymmetricKeyType).toBe('ed25519');
  expect(createPublicKey(keys.publicKeyPem).asymmetricKeyType).toBe('ed25519');
  expect(deriveRegistryPublicKey(keys.privateKeyPem)).toBe(keys.publicKeyPem);
}

function validSignature(payload: unknown, signature: AdapterPackageSignature,
  publicKeyPem: string): boolean {
  return verify(null, Buffer.from(signaturePayload(payload, signature)),
    publicKeyPem, Buffer.from(signature.value, 'base64'));
}

function publishOptions(privateKeyPem: string) {
  return { registryId: 'official', baseUrl: 'https://registry.example/releases',
    keyId: 'release-2026', privateKeyPem, timestamp: '2026-10-22T12:00:00.000Z' };
}

function packageDocument() {
  const source = adapterSource();
  const adapter = instantiateAdapterImplementationDraft(source);
  return createAdapterPackage({ adapter, implementationTs: source, origin: 'local-generated',
    createdAt: '2026-10-22T00:00:00.000Z' });
}

function adapterSource(): string {
  return `import { AdapterBase, CommonCapability, VerificationCapability, ChapterImagesCapability } from '../../base';
export class DemoAdapter extends AdapterBase { readonly id = 'demo'; readonly name = 'Demo';
readonly domains = ['demo.invalid']; readonly parseMode = 'playwright' as const;
readonly capabilities = { verification: true, metadata: false, chapterImages: true };
readonly common = new DemoCommon(this); readonly verification = new DemoVerification(this);
readonly chapterImages = new DemoImages(this); }
class DemoCommon extends CommonCapability { matchUrl(url: string): boolean { return url.includes('demo.invalid'); } }
class DemoVerification extends VerificationCapability { detectVerificationRequired(): boolean { return false; }
describeVerificationHandoff(): Record<string, unknown> { return { supported: false }; } }
class DemoImages extends ChapterImagesCapability { extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
void document; void sourceUrl; return []; } }`;
}
