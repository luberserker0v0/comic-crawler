import type { BrowserCapabilities } from '@comiccrawler/browser-client-sdk';
import { BrowserClientRegistry } from '../../../src/browser/browser-client-registry';
import type { ApiPrincipal } from '../../../src/security/api-security';
import type { IStorage } from '../../../src/storage/types';

const capabilities: BrowserCapabilities = {
  executionMode: 'managed-profile',
  navigation: true,
  renderedDom: true,
  humanHandoff: true,
  responsiveViewport: true,
};

describe('BrowserClientRegistry', () => {
  BrowserClientRegistryTestGroup1();
});

function principal(limits: ApiPrincipal['limits'] = {}): ApiPrincipal {
  return {
    userId: 'alice',
    roles: ['user'],
    permissions: new Set(['browser-client:register', 'browser-client:session-own']),
    limits,
    public: false,
  };
}

class MemoryStorage implements IStorage {
  private readonly values = new Map<string, unknown>();

  async read<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }
  async write(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
  async list(): Promise<string[]> {
    return [...this.values.keys()];
  }
  async exists(key: string): Promise<boolean> {
    return this.values.has(key);
  }
}

function BrowserClientRegistryTestGroup1(): void {
  it('stores only a credential hash and authenticates the issued credential', BrowserClientRegistryTestStoresOnlyACredentialHashAndAuthenticatesTheIssuedCredential);
  it('rotates and revokes credentials', BrowserClientRegistryTestRotatesAndRevokesCredentials);
  it('enforces the registered Browser Client limit', BrowserClientRegistryTestEnforcesTheRegisteredBrowserClientLimit);
}

async function BrowserClientRegistryTestStoresOnlyACredentialHashAndAuthenticatesTheIssuedCredential() {
    const storage = new MemoryStorage();
    const registry = new BrowserClientRegistry(storage);
    const enrollment = await registry.enroll(principal(), { name: 'Alice Chrome', capabilities });
    expect(enrollment.clientId).toMatch(/^bc_/);
    expect(enrollment.credential).toMatch(/^ccbc_/);
    expect(registry.authenticateCredential(enrollment.clientId, enrollment.credential)?.ownerUserId).toBe('alice');
    expect(registry.authenticateCredential(enrollment.clientId, 'invalid')).toBeUndefined();
    const stored = await storage.read<Array<Record<string, unknown>>>('browser-clients/records');
    expect(stored).toHaveLength(1);
    expect(stored?.[0]?.credentialHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.[0]).not.toHaveProperty('credential');
    expect(registry.list('alice')[0]).not.toHaveProperty('credentialHash');
}

async function BrowserClientRegistryTestRotatesAndRevokesCredentials() {
    const registry = new BrowserClientRegistry();
    const enrollment = await registry.enroll(principal(), { capabilities });
    const rotated = await registry.rotateCredential(enrollment.clientId);
    expect(rotated.credential).not.toBe(enrollment.credential);
    expect(registry.authenticateCredential(enrollment.clientId, enrollment.credential)).toBeUndefined();
    expect(registry.authenticateCredential(enrollment.clientId, rotated.credential)).toBeDefined();
    await registry.revoke(enrollment.clientId);
    expect(registry.authenticateCredential(enrollment.clientId, rotated.credential)).toBeUndefined();
}

async function BrowserClientRegistryTestEnforcesTheRegisteredBrowserClientLimit() {
    const registry = new BrowserClientRegistry();
    const limited = principal({ maxRegisteredBrowserClients: 1 });
    await registry.enroll(limited, { capabilities });
    await expect(registry.enroll(limited, { capabilities })).rejects.toThrow('maximum number of registered Browser Clients');
}
