import { z } from 'zod';
import type { GlobalConfig, SiteConfig, BlacklistRule } from '@comiccrawler/shared';
import { DEFAULTS } from '@comiccrawler/shared';

export const DownloadConfigSchema = z.object({
  directory: z.string().default('./downloads'),
  concurrency: z.number().min(1).max(20).default(5),
  namingTemplate: z.string().default('{title}/{chapter}/{index}'),
  imageFormat: z.enum(['original', 'jpg', 'png', 'webp']).default('original'),
  imageQuality: z.number().min(1).max(100).default(100),
});

export const ConcurrencyConfigSchema = z.object({
  taskLevel: z.number().min(1).max(10).default(3),
  siteLevel: z.number().min(1).max(5).default(2),
});

export const NetworkConfigSchema = z.object({
  proxy: z.string().optional(),
  timeout: z.number().min(1000).default(DEFAULTS.network.timeout),
  retries: z.number().min(0).max(10).default(DEFAULTS.network.retries),
  retryDelay: z.number().min(0).default(DEFAULTS.network.retryDelay),
  userAgent: z.string().optional(),
});

export const BrowserConfigSchema = z.object({
  mode: z.enum(['static', 'headless', 'auto']).default(DEFAULTS.browser.mode),
  headless: z.boolean().default(DEFAULTS.browser.headless),
  maxInstances: z.number().min(1).max(10).default(DEFAULTS.browser.maxInstances),
  timeout: z.number().min(1000).default(DEFAULTS.browser.timeout),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default(DEFAULTS.browser.waitUntil),
  waitForSelector: z.string().optional(),
  postLoadDelayMs: z.number().min(0).default(DEFAULTS.browser.postLoadDelayMs),
  challengeAutoAttempt: z.boolean().default(DEFAULTS.browser.challengeAutoAttempt),
  challengeWaitMs: z.number().min(0).default(DEFAULTS.browser.challengeWaitMs),
  channel: z.string().optional(),
  storageStatePath: z.string().optional(),
  userDataDir: z.string().optional(),
  handoff: z.object({
    mode: z.enum(['snapshot', 'cdp', 'managed']).default(DEFAULTS.browser.handoff.mode),
    cdpUrl: z.string().optional(),
    userDataDir: z.string().optional(),
    channel: z.string().optional(),
  }).default(DEFAULTS.browser.handoff),
}).default(DEFAULTS.browser);

export const ServerConfigSchema = z.object({
  port: z.number().min(1).max(65535).default(DEFAULTS.server.port),
  host: z.string().default(DEFAULTS.server.host),
  auth: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
});

export const LogConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  file: z.string().optional(),
});

export const I18nConfigSchema = z.object({
  language: z.string().default('zh-TW'),
  fallback: z.string().default('en'),
});

export const GlobalConfigSchema = z.object({
  download: DownloadConfigSchema,
  concurrency: ConcurrencyConfigSchema,
  network: NetworkConfigSchema,
  browser: BrowserConfigSchema,
  server: ServerConfigSchema,
  log: LogConfigSchema,
  i18n: I18nConfigSchema,
});

export const SiteConfigSchema = z.object({
  adapterId: z.string(),
  enabled: z.boolean().default(true),
  delay: z.number().min(0).optional(),
  concurrency: z.number().min(1).optional(),
  credentials: z
    .object({
      configured: z.boolean(),
    })
    .optional(),
});

export const BlacklistRuleSchema = z.object({
  id: z.string(),
  type: z.enum(['chapter', 'tag']),
  pattern: z.string(),
  adapterId: z.string().optional(),
});

export function validateGlobalConfig(config: unknown): GlobalConfig {
  return GlobalConfigSchema.parse(config);
}

export function validateSiteConfig(config: unknown): SiteConfig {
  return SiteConfigSchema.parse(config);
}

export function validateBlacklistRule(rule: unknown): BlacklistRule {
  return BlacklistRuleSchema.parse(rule);
}
