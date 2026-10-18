import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  BrowserCapabilities,
  BrowserClientEnrollmentRequest,
  BrowserClientEnrollmentResponse,
} from '@comiccrawler/browser-client-sdk';
import type { ApiPrincipal } from '../security/api-security';
import type { IStorage } from '../storage/types';

export interface BrowserClientRecord {
  clientId: string;
  ownerUserId: string;
  name: string;
  credentialId: string;
  credentialHash: string;
  registeredCapabilities: BrowserCapabilities;
  registeredAt: string;
  lastConnectedAt?: string;
  revokedAt?: string;
}

const STORAGE_KEY = 'browser-clients/records';

export class BrowserClientRegistry {
  private readonly records = new Map<string, BrowserClientRecord>();
  private readonly changeListeners = new Set<() => void>();

  constructor(private readonly storage?: IStorage) {}

  async initialize(): Promise<void> {
    const records = await this.storage?.read<BrowserClientRecord[]>(STORAGE_KEY) ?? [];
    for (const record of records) {
      validateStoredRecord(record);
      this.records.set(record.clientId, record);
    }
  }

  async enroll(
    principal: ApiPrincipal,
    request: BrowserClientEnrollmentRequest
  ): Promise<BrowserClientEnrollmentResponse> {
    validateCapabilities(request.capabilities);
    const name = request.name?.trim();
    if (name && name.length > 200) throw new Error('Browser Client name must not exceed 200 characters.');
    const registeredCount = [...this.records.values()].filter((record) =>
      record.ownerUserId === principal.userId && !record.revokedAt).length;
    if (principal.limits.maxRegisteredBrowserClients !== undefined
      && registeredCount >= principal.limits.maxRegisteredBrowserClients) {
      throw new Error('The maximum number of registered Browser Clients has been reached.');
    }

    const clientId = `bc_${randomUUID()}`;
    const issued = issueCredential();
    const registeredAt = new Date().toISOString();
    this.records.set(clientId, {
      clientId,
      ownerUserId: principal.userId,
      name: name || `Browser Client ${clientId.slice(-6)}`,
      credentialId: issued.credentialId,
      credentialHash: issued.credentialHash,
      registeredCapabilities: request.capabilities,
      registeredAt,
    });
    await this.persist();
    this.emitChange();
    return {
      clientId,
      credentialId: issued.credentialId,
      credential: issued.credential,
      registeredAt,
    };
  }

  list(ownerUserId?: string): Array<Record<string, unknown>> {
    return [...this.records.values()]
      .filter((record) => ownerUserId === undefined || record.ownerUserId === ownerUserId)
      .map(publicRecord);
  }

  getRecord(clientId: string): BrowserClientRecord | undefined {
    return this.records.get(clientId);
  }

  authenticateCredential(clientId: string, credential: string): BrowserClientRecord | undefined {
    const record = this.records.get(clientId);
    if (!record || record.revokedAt) return undefined;
    return secretHashEquals(record.credentialHash, hash(credential)) ? record : undefined;
  }

  async markConnected(clientId: string): Promise<void> {
    const record = this.requireRecord(clientId);
    record.lastConnectedAt = new Date().toISOString();
    await this.persist();
    this.emitChange();
  }

  async rotateCredential(clientId: string): Promise<BrowserClientEnrollmentResponse> {
    const record = this.requireRecord(clientId);
    if (record.revokedAt) throw new Error(`Browser Client "${clientId}" is revoked.`);
    const issued = issueCredential();
    record.credentialId = issued.credentialId;
    record.credentialHash = issued.credentialHash;
    await this.persist();
    this.emitChange();
    return {
      clientId,
      credentialId: issued.credentialId,
      credential: issued.credential,
      registeredAt: record.registeredAt,
    };
  }

  async revoke(clientId: string): Promise<void> {
    const record = this.requireRecord(clientId);
    if (record.revokedAt) return;
    record.revokedAt = new Date().toISOString();
    await this.persist();
    this.emitChange();
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  dispose(): void {
    this.changeListeners.clear();
  }

  private requireRecord(clientId: string): BrowserClientRecord {
    const record = this.records.get(clientId);
    if (!record) throw new Error(`Browser Client "${clientId}" was not found.`);
    return record;
  }

  private async persist(): Promise<void> {
    await this.storage?.write(STORAGE_KEY, [...this.records.values()]);
  }

  private emitChange(): void {
    for (const listener of [...this.changeListeners]) listener();
  }
}

function publicRecord(record: BrowserClientRecord): Record<string, unknown> {
  return {
    clientId: record.clientId,
    ownerUserId: record.ownerUserId,
    name: record.name,
    credentialId: record.credentialId,
    registeredCapabilities: record.registeredCapabilities,
    registeredAt: record.registeredAt,
    lastConnectedAt: record.lastConnectedAt,
    revokedAt: record.revokedAt,
  };
}

function validateStoredRecord(record: BrowserClientRecord): void {
  if (!record.clientId || !record.ownerUserId || !record.credentialId || !record.credentialHash || !record.registeredAt) {
    throw new Error('Invalid Browser Client record.');
  }
  validateCapabilities(record.registeredCapabilities);
}

function validateCapabilities(value: BrowserCapabilities): void {
  if (!value || typeof value !== 'object') throw new Error('Browser Client capabilities are required.');
  if (value.executionMode !== 'existing-tab' && value.executionMode !== 'managed-profile') {
    throw new Error('Browser Client capability "executionMode" is invalid.');
  }
  for (const key of [
    'navigation',
    'renderedDom',
    'humanHandoff',
    'responsiveViewport',
  ] as const) {
    if (typeof value[key] !== 'boolean') throw new Error(`Browser Client capability "${key}" must be boolean.`);
  }
}

function issueCredential(): { credentialId: string; credential: string; credentialHash: string } {
  const credential = `ccbc_${randomBytes(48).toString('base64url')}`;
  return {
    credentialId: `bcc_${randomUUID()}`,
    credential,
    credentialHash: hash(credential),
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function secretHashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
