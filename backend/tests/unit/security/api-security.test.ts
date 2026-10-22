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
  return ApiSecurityService.fromSecretDocument(TOKEN_POLICY, TOKEN_DOCUMENT);
}

const TOKEN_POLICY = { mode: 'token' as const, defaultEffect: 'deny' as const,
  secretPath: '/not-used-in-unit-test.json', rules: [
    { id: 'browser-client-register', methods: ['POST'], path: '/api/browser-clients/enroll', permission: 'browser-client:register' },
    { id: 'browser-client-read', methods: ['GET'], path: '/api/browser-clients', permission: 'browser-client:read-own' },
    { id: 'browser-client-manage', methods: ['DELETE'], path: '/api/browser-clients/**', permission: 'browser-client:manage-own' },
    { id: 'task-target-recovery', methods: ['POST'], path: '/api/tasks/:id/rebind-browser-target', permission: 'task:control-own' },
  ] };

const TOKEN_DOCUMENT = { schemaVersion: 1, roles: [{ id: 'browser-user', permissions: [
  'browser-client:register', 'browser-client:read-own', 'browser-client:manage-own',
  'browser-client:session-own', 'task:control-own',
], limits: { maxRegisteredBrowserClients: 2 } }], users: [
  { id: 'alice', token: aliceToken, roles: ['browser-user'], enabled: true },
  { id: 'bob', token: bobToken, roles: ['browser-user'], enabled: true },
] };

describe('API security policy', () => {
  APISecurityPolicyTestGroup1();
});

const capabilities: BrowserCapabilities = {
  executionMode: 'managed-profile',
  navigation: true,
  renderedDom: true,
  humanHandoff: true,
  responsiveViewport: true,
};

function APISecurityPolicyTestGroup1(): void {
  it('loads the secret document from disk and fails when it is missing', APISecurityPolicyTestLoadsTheSecretDocumentFromDiskAndFailsWhenItIsMissing);
  it('authenticates a user token and resolves roles, permissions, and limits', APISecurityPolicyTestAuthenticatesAUserTokenAndResolvesRolesPermissionsAndLimits);
  it('rejects missing and invalid user API tokens', APISecurityPolicyTestRejectsMissingAndInvalidUserAPITokens);
  it('denies API routes that are absent from the token policy', APISecurityPolicyTestDeniesAPIRoutesThatAreAbsentFromTheTokenPolicy);
  it('allows the ownership-aware task recovery route to perform its resource checks', APISecurityPolicyTestAllowsTheOwnershipAwareTaskRecoveryRouteToPerformItsResourceChecks);
  it('isolates Browser Client records by owner and blocks cross-user revocation', APISecurityPolicyTestIsolatesBrowserClientRecordsByOwnerAndBlocksCrossUserRevocation);
  it('rejects duplicate tokens and unknown permissions during startup validation', APISecurityPolicyTestRejectsDuplicateTokensAndUnknownPermissionsDuringStartupValidation);
}

async function APISecurityPolicyTestLoadsTheSecretDocumentFromDiskAndFailsWhenItIsMissing() {
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
}

function APISecurityPolicyTestAuthenticatesAUserTokenAndResolvesRolesPermissionsAndLimits() {
    const security = tokenSecurity();
    const result = security.authenticate({
        'x-comiccrawler-user-id': 'alice',
        authorization: `Bearer ${aliceToken}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok)
        return;
    expect(result.principal.userId).toBe('alice');
    expect(security.hasPermission(result.principal, 'browser-client:register')).toBe(true);
    expect(result.principal.limits.maxRegisteredBrowserClients).toBe(2);
}

function APISecurityPolicyTestRejectsMissingAndInvalidUserAPITokens() {
    const security = tokenSecurity();
    expect(security.authenticate({}).ok).toBe(false);
    expect(security.authenticate({
        'x-comiccrawler-user-id': 'alice',
        authorization: 'Bearer invalid-token',
    }).ok).toBe(false);
}

async function APISecurityPolicyTestDeniesAPIRoutesThatAreAbsentFromTheTokenPolicy() {
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
}

async function APISecurityPolicyTestAllowsTheOwnershipAwareTaskRecoveryRouteToPerformItsResourceChecks() {
    const security = tokenSecurity();
    const app = fastify();
    setupApiSecurity(app, security);
    app.post('/api/tasks/:id/rebind-browser-target', async () => ({ data: true }));
    const response = await app.inject({
        method: 'POST',
        url: '/api/tasks/task-1/rebind-browser-target',
        headers: {
            'x-comiccrawler-user-id': 'alice',
            authorization: `Bearer ${aliceToken}`,
        },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
}

async function APISecurityPolicyTestIsolatesBrowserClientRecordsByOwnerAndBlocksCrossUserRevocation() {
    const security = tokenSecurity();
    const registry = new BrowserClientRegistry();
    const gateway = new BrowserSessionGateway(registry, security);
    const app = createBrowserClientApp(security, registry, gateway);
    const aliceHeaders = userHeaders('alice', aliceToken);
    const bobHeaders = userHeaders('bob', bobToken);
    const clientId = await enrollBrowserClient(app, aliceHeaders);
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
}

async function enrollBrowserClient(app: ReturnType<typeof fastify>, headers: Record<string, string>) {
  const registered = await app.inject({ method: 'POST', url: '/api/browser-clients/enroll',
    headers, payload: { name: 'Alice PC', capabilities } });
  return registered.json().data.clientId as string;
}

function createBrowserClientApp(security: ApiSecurityService, registry: BrowserClientRegistry,
  gateway: BrowserSessionGateway) {
  const app = fastify();
  setupApiSecurity(app, security);
  setupBrowserClientRoutes(app, registry, gateway, security);
  return app;
}

function userHeaders(userId: string, token: string) {
  return { 'x-comiccrawler-user-id': userId, authorization: `Bearer ${token}` };
}

function APISecurityPolicyTestRejectsDuplicateTokensAndUnknownPermissionsDuringStartupValidation() {
    const policy = { mode: 'token' as const, defaultEffect: 'deny' as const,
        secretPath: '/not-used.json', rules: [] };
    expectInvalidSecurityDocument(policy, {
        schemaVersion: 1,
        roles: [{ id: 'reader', permissions: ['unknown:permission'] }],
        users: [{ id: 'alice', token: aliceToken, roles: ['reader'], enabled: true }],
    }, /Unknown API permission/);
    expectInvalidSecurityDocument(policy, {
        schemaVersion: 1,
        roles: [{ id: 'reader', permissions: ['system:read'] }],
        users: [{ id: 'alice', token: aliceToken, roles: ['reader'], enabled: true },
            { id: 'bob', token: aliceToken, roles: ['reader'], enabled: true }],
    }, /Duplicate user token/);
}

function expectInvalidSecurityDocument(policy: Parameters<typeof ApiSecurityService.fromSecretDocument>[0],
  document: Parameters<typeof ApiSecurityService.fromSecretDocument>[1], error: RegExp): void {
  expect(() => ApiSecurityService.fromSecretDocument(policy, document)).toThrow(error);
}
