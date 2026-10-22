import { createHash, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import type { ApiSecurityPolicyConfig } from '@comiccrawler/shared';
import { z } from 'zod';

export const API_PERMISSIONS = [
  'system:read',
  'config:read', 'config:write',
  'task:create', 'task:read', 'task:read-own', 'task:control', 'task:control-own', 'task:delete',
  'adapter:read', 'adapter:test', 'adapter:manage', 'adapter:review',
  'discovery:create', 'discovery:read', 'discovery:review',
  'browser-client:register', 'browser-client:read', 'browser-client:read-own',
  'browser-client:manage', 'browser-client:manage-own',
  'browser-client:session', 'browser-client:session-own',
  'fixture:read', 'fixture:manage',
  'maintenance:run',
] as const;

export interface ApiPrincipal {
  userId: string;
  roles: string[];
  permissions: Set<string>;
  limits: {
    maxConcurrentSessions?: number;
    maxRegisteredBrowserClients?: number;
    maxOnlineBrowserWorkers?: number;
  };
  public: boolean;
}

interface SecretDocument {
  schemaVersion: 1;
  roles: Array<{
    id: string;
    permissions: string[];
    limits?: ApiPrincipal['limits'];
  }>;
  users: Array<{
    id: string;
    token: string;
    roles: string[];
    enabled: boolean;
  }>;
}

export type AuthenticationResult =
  | { ok: true; principal: ApiPrincipal }
  | { ok: false; statusCode: 401 | 403; error: string };

const LimitsSchema = z.object({
  maxConcurrentSessions: z.number().int().positive().nullable().optional(),
  maxRegisteredBrowserClients: z.number().int().positive().nullable().optional(),
  maxOnlineBrowserWorkers: z.number().int().positive().nullable().optional(),
}).strict();

const SecretDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  roles: z.array(z.object({
    id: z.string().min(1),
    permissions: z.array(z.string().min(1)),
    limits: LimitsSchema.optional(),
  }).strict()),
  users: z.array(z.object({
    id: z.string().min(1),
    token: z.string().min(32),
    roles: z.array(z.string().min(1)).min(1),
    enabled: z.boolean().default(true),
  }).strict()),
}).strict();

const PUBLIC_PRINCIPAL: ApiPrincipal = {
  userId: 'public',
  roles: ['public'],
  permissions: new Set(['*']),
  limits: {},
  public: true,
};

export class ApiSecurityService {
  private constructor(
    readonly policy: ApiSecurityPolicyConfig,
    private readonly secrets?: SecretDocument
  ) {}

  static async create(policy: ApiSecurityPolicyConfig): Promise<ApiSecurityService> {
    validatePolicy(policy);
    if (policy.mode === 'public') return new ApiSecurityService(policy);
    if (!policy.secretPath) throw new Error('API security secretPath is required in token mode.');
    const raw = JSON.parse(await fs.readFile(policy.secretPath, 'utf8')) as unknown;
    const secrets = SecretDocumentSchema.parse(raw) as SecretDocument;
    validateSecrets(secrets);
    return new ApiSecurityService(policy, secrets);
  }

  static fromSecretDocument(policy: ApiSecurityPolicyConfig, value?: unknown): ApiSecurityService {
    validatePolicy(policy);
    if (policy.mode === 'public') return new ApiSecurityService(policy);
    const secrets = SecretDocumentSchema.parse(value) as SecretDocument;
    validateSecrets(secrets);
    return new ApiSecurityService(policy, secrets);
  }

  get mode(): ApiSecurityPolicyConfig['mode'] {
    return this.policy.mode;
  }

  publicPrincipal(): ApiPrincipal {
    return PUBLIC_PRINCIPAL;
  }

  authenticate(headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>): AuthenticationResult {
    if (this.policy.mode === 'public') return { ok: true, principal: PUBLIC_PRINCIPAL };
    const userIdHeader = headers['x-comiccrawler-user-id'];
    const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;
    const token = bearerToken(headers.authorization);
    if (!userId || !token) {
      return { ok: false, statusCode: 401, error: 'User ID and Bearer user API token are required.' };
    }
    const user = this.secrets?.users.find((candidate) => candidate.id === userId);
    if (!user || !user.enabled || !secretEquals(user.token, token)) {
      return { ok: false, statusCode: 401, error: 'User API token is invalid.' };
    }
    return { ok: true, principal: this.principalForUser(user.id)! };
  }

  principalForUser(userId: string): ApiPrincipal | undefined {
    if (this.policy.mode === 'public') return userId === PUBLIC_PRINCIPAL.userId ? PUBLIC_PRINCIPAL : undefined;
    const user = this.secrets?.users.find((candidate) => candidate.id === userId && candidate.enabled);
    if (!user) return undefined;
    const roles = user.roles.map((roleId) => this.secrets!.roles.find((role) => role.id === roleId)!);
    return {
      userId: user.id,
      roles: [...user.roles],
      permissions: new Set(roles.flatMap((role) => role.permissions)),
      limits: mergeLimits(roles.map((role) => role.limits)),
      public: false,
    };
  }

  permissionFor(method: string, pathname: string): string | undefined {
    const normalizedMethod = method.toUpperCase();
    return this.policy.rules.find((rule) =>
      rule.methods.some((candidate) => candidate.toUpperCase() === normalizedMethod)
      && matchesPath(rule.path, pathname))?.permission;
  }

  hasPermission(principal: ApiPrincipal, permission: string): boolean {
    if (principal.permissions.has('*') || principal.permissions.has(permission)) return true;
    if (permission.endsWith('-own') && principal.permissions.has(permission.slice(0, -4))) return true;
    return false;
  }
}

export function resolveApiSecurityPolicy(config?: ApiSecurityPolicyConfig): ApiSecurityPolicyConfig {
  const mode = process.env.COMICCRAWLER_API_SECURITY_MODE?.trim() as ApiSecurityPolicyConfig['mode'] | undefined;
  if (mode && mode !== 'public' && mode !== 'token') {
    throw new Error(`Invalid COMICCRAWLER_API_SECURITY_MODE "${mode}".`);
  }
  const base = config ?? { mode: 'public', defaultEffect: 'deny', rules: [] };
  return {
    ...base,
    ...(mode ? { mode } : {}),
    ...(process.env.COMICCRAWLER_API_SECURITY_SECRET_PATH?.trim()
      ? { secretPath: process.env.COMICCRAWLER_API_SECURITY_SECRET_PATH.trim() }
      : {}),
  };
}

function validatePolicy(policy: ApiSecurityPolicyConfig): void {
  if (policy.defaultEffect !== 'deny') throw new Error('API security defaultEffect must be deny.');
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const rule of policy.rules) {
    if (ids.has(rule.id)) throw new Error(`Duplicate API security rule ID "${rule.id}".`);
    ids.add(rule.id);
    for (const method of rule.methods) {
      const route = `${method.toUpperCase()} ${rule.path}`;
      if (routes.has(route)) throw new Error(`Overlapping API security rule for "${route}".`);
      routes.add(route);
    }
    if (rule.permission !== '*' && !API_PERMISSIONS.includes(rule.permission as typeof API_PERMISSIONS[number])) {
      throw new Error(`Unknown API permission "${rule.permission}".`);
    }
  }
}

function validateSecrets(secrets: SecretDocument): void {
  unique(secrets.roles.map((role) => role.id), 'role ID');
  unique(secrets.users.map((user) => user.id), 'user ID');
  unique(secrets.users.map((user) => hash(user.token)), 'user token');
  const roleIds = new Set(secrets.roles.map((role) => role.id));
  for (const role of secrets.roles) validateRole(role);
  for (const user of secrets.users) validateUserRoles(user, roleIds);
}

function validateRole(role: SecretDocument['roles'][number]): void {
  if (role.id !== 'admin' && role.limits && Object.values(role.limits).some((value) => value === null)) {
    throw new Error(`Unlimited Browser Client limits are reserved for the admin role; role "${role.id}" contains null.`);
  }
  for (const permission of role.permissions) {
    if (permission === '*' && role.id !== 'admin') throw new Error('The * permission is reserved for the admin role.');
    if (permission !== '*' && !API_PERMISSIONS.includes(permission as typeof API_PERMISSIONS[number])) {
      throw new Error(`Unknown API permission "${permission}" in role "${role.id}".`);
    }
  }
}

function validateUserRoles(user: SecretDocument['users'][number], roleIds: Set<string>): void {
  for (const roleId of user.roles) {
    if (!roleIds.has(roleId)) throw new Error(`User "${user.id}" references unknown role "${roleId}".`);
  }
}

function mergeLimits(values: Array<ApiPrincipal['limits'] | undefined>): ApiPrincipal['limits'] {
  const result: ApiPrincipal['limits'] = {};
  for (const key of [
    'maxConcurrentSessions',
    'maxRegisteredBrowserClients',
    'maxOnlineBrowserWorkers',
  ] as const) {
    const limits = values.map((value) => value?.[key]);
    if (limits.some((value) => value === null)) continue;
    const numbers = limits.filter((value): value is number => typeof value === 'number');
    if (numbers.length) result[key] = Math.max(...numbers);
  }
  return result;
}

function unique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label} "${value}".`);
    seen.add(value);
  }
}

function matchesPath(pattern: string, pathname: string): boolean {
  const escaped = pattern.split('**').map((part) => part
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z0-9_]+/g, '[^/]+'));
  return new RegExp(`^${escaped.join('.*')}$`).test(pathname);
}

function bearerToken(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  return header?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function secretEquals(expected: string, actual: string): boolean {
  const left = Buffer.from(hash(expected), 'hex');
  const right = Buffer.from(hash(actual), 'hex');
  return timingSafeEqual(left, right);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
