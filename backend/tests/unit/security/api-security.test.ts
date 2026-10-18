import { describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserCapabilities } from '@comiccrawler/browser-client-sdk';
import { BrowserClientRegistry } from '../../../src/browser/browser-client-registry';
import { BrowserSessionGateway } from '../../../src/browser/browser-session-gateway';
import { ApiSecurityService } from '../../../src/security/api-security';
import { setupApiSecurity } from '../../../src/server/middleware/api-security';
import { setupBrowserClientRoutes } from '../../../src/server/routes/browser-clients';

const aliceToken = 'alice-token-00000000000000000000000000000000';
const bobToken = 'bob-token-000000000000000000000000000000000';

function tokenSecurity() {
  return ApiSecurityService.fromSecretDocument({
    mode: 'token',
    defaultEffect: 'deny',
    secretPath: '/not-used-in-unit-test.json',
    rules: [
      {
        id: 'browser-client-register',
        methods: ['POST'],
        path: '/api/browser-clients/enroll',
        permission: 'browser-client:register',
      },
      {
        id: 'browser-client-read',
        methods: ['GET'],
        path: '/api/browser-clients',
        permission: 'browser-client:read-own',
      },
      {
        id: 'browser-client-manage',
        methods: ['DELETE'],
        path: '/api/browser-clients/**',
        permission: 'browser-client:manage-own',
      },
    ],
  }, {
    schemaVersion: 1,
    roles: [{
      id: 'browser-user',
      permissions: [
        'browser-client:register',
        'browser-client:read-own',
        'browser-client:manage-own',
        'browser-client:session-own',
      ],
      limits: { maxRegisteredBrowserClients: 2 },
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
    expect(security.hasPermission(result.principal, 'browser-client:register')).toBe(true);
    expect(result.principal.limits.maxRegisteredBrowserClients).toBe(2);
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

  it('isolates Browser Client records by owner and blocks cross-user revocation', async () => {
    const security = tokenSecurity();
    const registry = new BrowserClientRegistry();
    const gateway = new BrowserSessionGateway(registry, security);
    const app = fastify();
    setupApiSecurity(app, security);
    setupBrowserClientRoutes(app, registry, gateway, security);

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
      url: '/api/browser-clients/enroll',
      headers: aliceHeaders,
      payload: { name: 'Alice PC', capabilities },
    });
    const clientId = registered.json().data.clientId as string;

    const bobList = await app.inject({ method: 'GET', url: '/api/browser-clients', headers: bobHeaders });
    expect(bobList.json().data.clients).toEqual([]);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/browser-clients/${clientId}`,
      headers: bobHeaders,
    });
    expect(revoke.statusCode).toBe(403);
    expect(registry.getRecord(clientId)?.revokedAt).toBeUndefined();
    gateway.dispose();
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

const capabilities: BrowserCapabilities = {
  executionMode: 'managed-profile',
  navigation: true,
  renderedDom: true,
  humanHandoff: true,
  responsiveViewport: true,
};
