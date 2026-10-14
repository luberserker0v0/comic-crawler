import type { GlobalConfig, SiteConfig, BlacklistRule } from '@comiccrawler/shared';
import { DEFAULTS } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import type { EventBus } from '../events/bus';
import { validateGlobalConfig, validateSiteConfig, validateBlacklistRule } from './schema';

const CONFIG_KEY = 'global';
const SITES_KEY = 'sites';
const BLACKLIST_KEY = 'blacklist';

export class ConfigManager {
  private storage: IStorage;
  private eventBus?: EventBus;
  private cache: GlobalConfig | null = null;

  constructor(storage: IStorage, eventBus?: EventBus) {
    this.storage = storage;
    this.eventBus = eventBus;
  }

  async load(): Promise<GlobalConfig> {
    const stored = await this.storage.read<GlobalConfig>(CONFIG_KEY);
    if (stored) {
      const migration = migrateLegacyBrowserConfig(stored);
      const validated = validateGlobalConfig(migration.config);
      if (migration.migrated) {
        await this.save(validated);
      }
      this.cache = applyMaintenanceEnvOverrides(applyBrowserEnvOverrides(validated));
    } else {
      this.cache = applyMaintenanceEnvOverrides(applyBrowserEnvOverrides(this.getDefaultConfig()));
      await this.save(this.cache);
    }
    return this.cache;
  }

  async get(): Promise<GlobalConfig> {
    if (!this.cache) {
      return this.load();
    }
    return this.cache;
  }

  async update(partial: Partial<GlobalConfig>): Promise<GlobalConfig> {
    const current = await this.get();
    const merged = { ...current, ...partial };
    this.cache = validateGlobalConfig(merged);
    await this.save(this.cache);
    return this.cache;
  }

  async reset(): Promise<GlobalConfig> {
    this.cache = this.getDefaultConfig();
    await this.save(this.cache);
    return this.cache;
  }

  async getSiteConfig(adapterId: string): Promise<SiteConfig | undefined> {
    const sites = (await this.storage.read<Record<string, SiteConfig>>(SITES_KEY)) ?? {};
    return sites[adapterId];
  }

  async setSiteConfig(adapterId: string, config: SiteConfig): Promise<void> {
    const sites = (await this.storage.read<Record<string, SiteConfig>>(SITES_KEY)) ?? {};
    sites[adapterId] = validateSiteConfig(config);
    await this.storage.write(SITES_KEY, sites);
    this.eventBus?.emit('config:changed', { key: `sites.${adapterId}`, value: config });
  }

  async removeSiteConfig(adapterId: string): Promise<void> {
    const sites = (await this.storage.read<Record<string, SiteConfig>>(SITES_KEY)) ?? {};
    delete sites[adapterId];
    await this.storage.write(SITES_KEY, sites);
  }

  async getAllSiteConfigs(): Promise<Record<string, SiteConfig>> {
    return (await this.storage.read<Record<string, SiteConfig>>(SITES_KEY)) ?? {};
  }

  async getBlacklist(): Promise<BlacklistRule[]> {
    return (await this.storage.read<BlacklistRule[]>(BLACKLIST_KEY)) ?? [];
  }

  async addBlacklistRule(rule: BlacklistRule): Promise<void> {
    const rules = await this.getBlacklist();
    rules.push(validateBlacklistRule(rule));
    await this.storage.write(BLACKLIST_KEY, rules);
  }

  async removeBlacklistRule(id: string): Promise<void> {
    const rules = await this.getBlacklist();
    const filtered = rules.filter((r) => r.id !== id);
    await this.storage.write(BLACKLIST_KEY, filtered);
  }

  private async save(config: GlobalConfig): Promise<void> {
    await this.storage.write(CONFIG_KEY, config);
    this.eventBus?.emit('config:changed', { key: CONFIG_KEY, value: config });
  }

  private getDefaultConfig(): GlobalConfig {
    return {
      download: {
        directory: './downloads',
        concurrency: 5,
        namingTemplate: '{title}/{chapter}/{index}',
        imageFormat: 'original',
        imageQuality: 100,
      },
      concurrency: {
        taskLevel: DEFAULTS.concurrency.taskLevel,
        siteLevel: DEFAULTS.concurrency.siteLevel,
      },
      network: {
        timeout: DEFAULTS.network.timeout,
        retries: DEFAULTS.network.retries,
        retryDelay: DEFAULTS.network.retryDelay,
      },
      browser: {
        mode: DEFAULTS.browser.mode,
        maxInstances: DEFAULTS.browser.maxInstances,
        timeout: DEFAULTS.browser.timeout,
        waitUntil: DEFAULTS.browser.waitUntil,
        postLoadDelayMs: DEFAULTS.browser.postLoadDelayMs,
        challengeAutoAttempt: DEFAULTS.browser.challengeAutoAttempt,
        challengeWaitMs: DEFAULTS.browser.challengeWaitMs,
        remote: DEFAULTS.browser.remote,
      },
      server: {
        port: DEFAULTS.server.port,
        host: DEFAULTS.server.host,
      },
      log: {
        level: 'info',
      },
      i18n: {
        language: DEFAULTS.i18n.language,
        fallback: DEFAULTS.i18n.fallback,
      },
      maintenance: {
        enabled: true,
        intervalHours: 24,
        tasksRetainDays: 30,
        discoveryJobsRetainDays: 14,
        deleteFiles: true,
        batchLimit: 100,
      },
    };
  }
}

function migrateLegacyBrowserConfig(config: unknown): { config: unknown; migrated: boolean } {
  if (!config || typeof config !== 'object') {
    return { config, migrated: false };
  }
  const record = config as Record<string, unknown>;
  const browser = record.browser;
  if (!browser || typeof browser !== 'object') {
    return { config, migrated: false };
  }
  const browserRecord = browser as Record<string, unknown>;
  if (!['static', 'headless', 'auto'].includes(String(browserRecord.mode))) {
    return { config, migrated: false };
  }
  const {
    channel: _channel,
    handoff: _handoff,
    headless: _headless,
    userDataDir: _userDataDir,
    ...supportedBrowserConfig
  } = browserRecord;
  return {
    config: {
      ...record,
      browser: {
        ...supportedBrowserConfig,
        mode: 'remote',
      },
    },
    migrated: true,
  };
}

function resolveRemoteBrowserDefaults(): GlobalConfig['browser']['remote'] {
  const timeoutValue = Number(process.env.COMICCRAWLER_BROWSER_CONNECT_TIMEOUT);
  return {
    ...(process.env.COMICCRAWLER_BROWSER_CONNECT_TIMEOUT && Number.isFinite(timeoutValue) && timeoutValue >= 1000
      ? { connectTimeout: timeoutValue }
      : {}),
    ...(process.env.COMICCRAWLER_BROWSER_EXPOSE_NETWORK
      ? { exposeNetwork: process.env.COMICCRAWLER_BROWSER_EXPOSE_NETWORK }
      : {}),
  };
}

function applyBrowserEnvOverrides(config: GlobalConfig): GlobalConfig {
  const remote = resolveRemoteBrowserDefaults();
  const browserOverrides: Partial<GlobalConfig['browser']> = {};
  if (
    process.env.COMICCRAWLER_BROWSER_CONNECT_TIMEOUT ||
    process.env.COMICCRAWLER_BROWSER_EXPOSE_NETWORK
  ) {
    browserOverrides.remote = {
      ...(config.browser.remote ?? {}),
      ...remote,
    };
  }

  return {
    ...config,
    browser: {
      ...config.browser,
      ...browserOverrides,
    },
  };
}
function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function parseEnvNumber(value: string | undefined): number | undefined {
  if (value === undefined || !value.trim()) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function applyMaintenanceEnvOverrides(config: GlobalConfig): GlobalConfig {
  const base = config.maintenance ?? {
    enabled: true,
    intervalHours: 24,
    tasksRetainDays: 30,
    discoveryJobsRetainDays: 14,
    deleteFiles: true,
    batchLimit: 100,
  };
  const enabled = parseEnvBoolean(process.env.COMICCRAWLER_MAINTENANCE_ENABLED);
  const intervalHours = parseEnvNumber(process.env.COMICCRAWLER_MAINTENANCE_INTERVAL_HOURS);
  const tasksRetainDays = parseEnvNumber(process.env.COMICCRAWLER_MAINTENANCE_TASKS_RETAIN_DAYS);
  const jobsRetainDays = parseEnvNumber(process.env.COMICCRAWLER_MAINTENANCE_JOBS_RETAIN_DAYS);
  const deleteFiles = parseEnvBoolean(process.env.COMICCRAWLER_MAINTENANCE_DELETE_FILES);
  if (
    enabled === undefined &&
    intervalHours === undefined &&
    tasksRetainDays === undefined &&
    jobsRetainDays === undefined &&
    deleteFiles === undefined
  ) {
    return { ...config, maintenance: base };
  }
  return {
    ...config,
    maintenance: {
      ...base,
      ...(enabled !== undefined ? { enabled } : {}),
      ...(intervalHours !== undefined ? { intervalHours } : {}),
      ...(tasksRetainDays !== undefined ? { tasksRetainDays } : {}),
      ...(jobsRetainDays !== undefined ? { discoveryJobsRetainDays: jobsRetainDays } : {}),
      ...(deleteFiles !== undefined ? { deleteFiles } : {}),
    },
  };
}
