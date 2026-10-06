import type { Command } from 'commander';
import type { ConfigManager } from '../config/manager';
import type { TaskManager } from '../task/manager';
import type { AdapterRegistry } from '../adapter/registry';
import type { CrawlerEngine } from '../crawler/engine';
import type { AgentAdminService } from '../agent/admin-service';
import type { SelectorDiscoveryService } from '../selector-discovery';
import type { MaintenanceService } from '../maintenance/service';
import type { TerminalUI } from './ui';

export interface CliOptions {
  configManager: ConfigManager;
  taskManager: TaskManager;
  adapterRegistry: AdapterRegistry;
  crawlerEngine: CrawlerEngine;
  agentAdminService: AgentAdminService;
  selectorDiscoveryService?: SelectorDiscoveryService;
  maintenanceService?: MaintenanceService;
}

export interface CliCommandContext {
  program: Command;
  options: CliOptions;
  ui: TerminalUI;
}
