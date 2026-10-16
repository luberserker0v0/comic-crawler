import { describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserProviderRegistry } from '../../../src/browser/provider-registry';
import { ApiSecurityService } from '../../../src/security/api-security';
import { setupApiSecurity } from '../../../src/server/middleware/api-security';
import { setupBrowserProviderRoutes } from '../../../src/server/routes/browser-providers';

const aliceToken = 'alice-token-00000000000000000000000000000000';
const bobToken = 'bob-token-000000000000000000000000000000000';

function tokenSecurity() {
  return ApiSecurityService.fromSecretDocument({
    mode: 'token',
    defaultEffect: 'deny',
    secretPath: '/not-used-in-unit-test.json',
    rules: [
      {
        id: 'provider-register',
        methods: ['POST'],
        path: '/api/browser-providers/enroll',
        permission: 'browser-provider:register',
      },
      {
        id: 'provider-read',
        methods: ['GET'],
        path: '/api/browser-providers',
        permission: 'browser-provider:read-own',
      },
      {
        id: 'provider-manage',
        methods: ['DELETE'],
        path: '/api/browser-providers/**',
        permission: 'browser-provider:manage-own',
      },
    ],
  }, {
    schemaVersion: 1,
    roles: [{
      id: 'browser-user',
      permissions: [
        'browser-provider:register',
        'browser-provider:read-own',
        'browser-provider:manage-own',
      ],
      limits: { maxRegisteredProviders: 2 },
    }],
    users: [
      { id: 'alice', token: aliceToken, roles: ['browser-user'], enabled: true },
      { id: 'bob', token: bobToken, roles: ['browser-user'], enabled: true },
    ],
  });
}

describe('API security policy', () => {
  it('loads the secret document from disk and fails when it is missing', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'comiccrawler-security-'));
    const secretPath = join(root, 'api-security.json');
    await fs.writeFile(secretPath, JSON.stringify({
      schemaVersion: 1,
      roles: [{ id: 'reader', permissions: ['system:read'] }],
      users: [{ id: 'alice', token: aliceToken, roles: ['reader'], enabled: true }],
    }));
    const policy = { mode: 'token' as const, defaultEffect: 'deny' as const, secretPath, rules: [] };

    await expect(ApiSecurityService.create(policy)).resolves.toBeInstanceOf(ApiSecurityService);
    await expect(ApiSecurityService.create({ ...policy, secretPath: join(root, 'missing.json') })).rejects.toThrow();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('authenticates a user token and resolves roles, permissions, and limits', () => {
    const security = tokenSecurity();
    const result = security.authenticate({
      'x-comiccrawler-user-id': 'alice',
      authorization: `Bearer ${aliceToken}`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.userId).toBe('alice');
    expect(security.hasPermission(result.principal, 'browser-provider:register')).toBe(true);
    expect(result.principal.limits.maxRegisteredProviders).toBe(2);
  });

  it('rejects missing and invalid user API tokens', () => {
    const security = tokenSecurity();
    expect(security.authenticate({}).ok).toBe(false);
    expect(security.authenticate({
      'x-comiccrawler-user-id': 'alice',
      authorization: 'Bearer invalid-token',
    }).ok).toBe(false);
  });

  it('denies API routes that are absent from the token policy', async () => {
    const security = tokenSecurity();
    const app = fastify();
    setupApiSecurity(app, security);
    app.get('/api/unlisted', async () => ({ data: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/unlisted',
      headers: {
        'x-comiccrawler-user-id': 'alice',
        authorization: `Bearer ${aliceToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('isolates provider records by owner and blocks cross-user revocation', async () => {
    const security = tokenSecurity();
    const registry = new BrowserProviderRegistry();
    const app = fastify();
    setupApiSecurity(app, security);
    setupBrowserProviderRoutes(app, registry, security);

    const aliceHeaders = {
      'x-comiccrawler-user-id': 'alice',
      authorization: `Bearer ${aliceToken}`,
    };
    const bobHeaders = {
      'x-comiccrawler-user-id': 'bob',
      authorization: `Bearer ${bobToken}`,
    };
    const registered = await app.inject({
      method: 'POST',
      url: '/api/browser-providers/enroll',
      headers: aliceHeaders,
      payload: { clientInstanceId: 'alice-pc' },
    });
    const providerId = registered.json().data.providerId as string;

    const bobList = await app.inject({ method: 'GET', url: '/api/browser-providers', headers: bobHeaders });
    expect(bobList.json().data.providers).toEqual([]);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/browser-providers/${providerId}`,
      headers: bobHeaders,
    });
    expect(revoke.statusCode).toBe(403);
    expect(registry.getRecord(providerId)?.revokedAt).toBeUndefined();
    await app.close();
  });

  it('rejects duplicate tokens and unknown permissions during startup validation', () => {
    const policy = {
      mode: 'token' as const,
      defaultEffect: 'deny' as const,
      secretPath: '/not-used.json',
      rules: [],
    };
    expect(() => ApiSecurityService.fromSecretDocument(policy, {
      schemaVersion: 1,
      roles: [{ id: 'reader', permissions: ['unknown:permission'] }],
      users: [{ id: 'alice', token: aliceToken, roles: ['reader'], enabled: true }],
    })).toThrow(/Unknown API permission/);

    expect(() => ApiSecurityService.fromSecretDocument(policy, {
      schemaVersion: 1,
      roles: [{ id: 'reader', permissions: ['system:read'] }],
      users: [
        { id: 'alice', token: aliceToken, roles: ['reader'], enabled: true },
        { id: 'bob', token: aliceToken, roles: ['reader'], enabled: true },
      ],
    })).toThrow(/Duplicate user token/);
  });
});
