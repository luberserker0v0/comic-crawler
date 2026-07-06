import type { SiteManifest } from '../adapter/sites/types';

export interface ExtractionFailureContext {
  [key: string]: unknown;
  adapterId: string;
  parseMode: 'static' | 'dynamic' | 'interactive';
  repairMode: 'selector-only' | 'parser-hook';
  repairTargets: string[];
  fixturesRoot: string;
  fixtureRefs: string[];
  pageType: 'metadata' | 'chapters' | 'images' | 'unknown';
  selector?: string;
  selectorName?: string;
  url: string;
  htmlSample?: string;
  message: string;
}

export function buildExtractionFailureContext(options: {
  adapterId: string;
  manifest: SiteManifest;
  pageType?: 'metadata' | 'chapters' | 'images';
  selector?: string;
  selectorName?: string;
  url: string;
  html?: string;
  message: string;
}): ExtractionFailureContext {
  const { adapterId, manifest, pageType, selector, selectorName, url, html, message } = options;
  const fixtureRefs = [
    manifest.maintenance.metadataFixture.htmlFile,
    manifest.maintenance.metadataFixture.expectedFile,
    manifest.maintenance.imageFixture?.htmlFile,
    manifest.maintenance.imageFixture?.expectedFile,
  ].filter((value): value is string => Boolean(value));

  return {
    adapterId,
    parseMode: manifest.parseMode,
    repairMode: manifest.maintenance.repairMode,
    repairTargets: manifest.maintenance.repairTargets,
    fixturesRoot: manifest.maintenance.fixturesRoot,
    fixtureRefs,
    pageType: pageType ?? 'unknown',
    selector,
    selectorName,
    url,
    htmlSample: html ? html.slice(0, 10_240) : undefined,
    message,
  };
}
