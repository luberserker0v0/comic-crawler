import type { ImageFormat } from './task';

export interface GlobalConfig {
  download: DownloadConfig;
  concurrency: ConcurrencyConfig;
  network: NetworkConfig;
  browser: BrowserConfig;
  server: ServerConfig;
  log: LogConfig;
  i18n: I18nConfig;
}

export interface DownloadConfig {
  directory: string;
  concurrency: number;
  namingTemplate: string;
  imageFormat: ImageFormat;
  imageQuality: number;
}

export interface ConcurrencyConfig {
  taskLevel: number;
  siteLevel: number;
}

export interface NetworkConfig {
  proxy?: string;
  timeout: number;
  retries: number;
  retryDelay: number;
  userAgent?: string;
}

export interface BrowserConfig {
  mode: 'static' | 'headless' | 'auto';
  headless: boolean;
  maxInstances: number;
  timeout: number;
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
  waitForSelector?: string;
  postLoadDelayMs?: number;
  challengeAutoAttempt?: boolean;
  challengeWaitMs?: number;
  channel?: string;
  storageStatePath?: string;
  userDataDir?: string;
  handoff?: BrowserHandoffConfig;
}

export interface BrowserHandoffConfig {
  mode: 'snapshot' | 'cdp' | 'managed';
  cdpUrl?: string;
  userDataDir?: string;
  channel?: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  auth?: {
    username: string;
    password: string;
  };
}

export interface LogConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  file?: string;
}

export interface I18nConfig {
  language: string;
  fallback: string;
}

export interface SiteConfig {
  adapterId: string;
  enabled: boolean;
  delay?: number;
  concurrency?: number;
  credentials?: {
    configured: boolean;
  };
}

export interface BlacklistRule {
  id: string;
  type: 'chapter' | 'tag';
  pattern: string;
  adapterId?: string;
}
