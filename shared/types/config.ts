import type { ImageFormat } from './task';

export interface GlobalConfig {
  download: DownloadConfig;
  concurrency: ConcurrencyConfig;
  network: NetworkConfig;
  browser: BrowserConfig;
  server: ServerConfig;
  log: LogConfig;
  i18n: I18nConfig;
  maintenance?: MaintenanceConfig;
  apiSecurity?: ApiSecurityPolicyConfig;
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
  timeout: number;
  workerWaitTimeoutMs?: number;
  postLoadDelayMs?: number;
}

export interface ServerConfig {
  port: number;
  host: string;
}

export type ApiSecurityMode = 'public' | 'token';

export interface ApiSecurityRuleConfig {
  id: string;
  methods: string[];
  path: string;
  permission: string;
}

export interface ApiSecurityPolicyConfig {
  mode: ApiSecurityMode;
  defaultEffect: 'deny';
  secretPath?: string;
  rules: ApiSecurityRuleConfig[];
}

export interface LogConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  file?: string;
}

export interface I18nConfig {
  language: string;
  fallback: string;
}

export interface MaintenanceConfig {
  enabled: boolean;
  intervalHours: number;
  tasksRetainDays: number;
  discoveryJobsRetainDays: number;
  deleteFiles: boolean;
  batchLimit: number;
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
