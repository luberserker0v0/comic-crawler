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
      this.cache = applyBrowserEnvOverrides(validateGlobalConfig(stored));
    } else {
      this.cache = applyBrowserEnvOverrides(this.getDefaultConfig());
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
        headless: DEFAULTS.browser.headless,
        maxInstances: DEFAULTS.browser.maxInstances,
        timeout: DEFAULTS.browser.timeout,
        waitUntil: DEFAULTS.browser.waitUntil,
        postLoadDelayMs: DEFAULTS.browser.postLoadDelayMs,
        challengeAutoAttempt: DEFAULTS.browser.challengeAutoAttempt,
        challengeWaitMs: DEFAULTS.browser.challengeWaitMs,
        handoff: resolveBrowserHandoffDefaults(),
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
    };
  }
}

function resolveBrowserHandoffDefaults(): GlobalConfig['browser']['handoff'] {
  const mode = process.env.COMICCRAWLER_BROWSER_HANDOFF_MODE;
  const normalizedMode = mode === 'cdp' || mode === 'managed' || mode === 'snapshot'
    ? mode
    : DEFAULTS.browser.handoff.mode;
  return {
    mode: normalizedMode,
    cdpUrl: process.env.COMICCRAWLER_BROWSER_CDP_URL,
    userDataDir: process.env.COMICCRAWLER_BROWSER_USER_DATA_DIR,
    channel: process.env.COMICCRAWLER_BROWSER_CHANNEL,
  };
}

function applyBrowserEnvOverrides(config: GlobalConfig): GlobalConfig {
  const handoff = resolveBrowserHandoffDefaults();
  const browserOverrides: Partial<GlobalConfig['browser']> = {};
  if (process.env.COMICCRAWLER_BROWSER_USER_DATA_DIR) {
    browserOverrides.userDataDir = process.env.COMICCRAWLER_BROWSER_USER_DATA_DIR;
  }
  if (process.env.COMICCRAWLER_BROWSER_CHANNEL) {
    browserOverrides.channel = process.env.COMICCRAWLER_BROWSER_CHANNEL;
  }
  if (
    process.env.COMICCRAWLER_BROWSER_HANDOFF_MODE ||
    process.env.COMICCRAWLER_BROWSER_CDP_URL ||
    process.env.COMICCRAWLER_BROWSER_USER_DATA_DIR ||
    process.env.COMICCRAWLER_BROWSER_CHANNEL
  ) {
    browserOverrides.handoff = {
      ...(config.browser.handoff ?? { mode: 'snapshot' as const }),
      ...handoff,
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
