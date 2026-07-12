import type { SiteSelectors } from '@comiccrawler/shared';

export type RepairMode = 'selector-only' | 'parser-hook';

export interface SiteFixtureProfile {
  name: string;
  baseUrl: string;
  htmlFile: string;
  expectedFile?: string;
}

export interface SiteMaintenanceProfile {
  repairMode: RepairMode;
  repairTargets: string[];
  sourceRoot: string;
  selectorExportName: string;
  fixturesRoot?: string;
  parserExportName?: string;
  metadataFixture?: SiteFixtureProfile;
  imageFixture?: SiteFixtureProfile;
}

export interface SiteManifest {
  id: string;
  parseMode: 'static' | 'dynamic' | 'interactive';
  selectors: SiteSelectors;
  maintenance: SiteMaintenanceProfile;
}
