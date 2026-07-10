import type { SiteSelectors } from '@comiccrawler/shared';

export const DEFAULT_SELECTOR_DISCOVERY_MODEL = 'my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive';
export const DEFAULT_SELECTOR_DISCOVERY_AGENT = 'selector-discovery';
export const KURONAVI_DISCOVERY_TEST_URL = 'https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu';

export interface ProviderDocument {
  provider: Record<string, {
    name?: string;
    npm?: string;
    options?: Record<string, unknown>;
    models?: Record<string, { name?: string }>;
  }>;
}

export interface SelectorDiscoverySettings {
  aoBaseUrl: string;
  model: string;
  providerFingerprint: string;
  providerIds: string[];
  modelIds: string[];
  configuredAt: string;
  warnings?: string[];
}

export interface SelectorDiscoverySettingsSummary {
  configured: boolean;
  aoBaseUrl?: string;
  model?: string;
  providerFingerprint?: string;
  providerIds: string[];
  modelIds: string[];
  configuredAt?: string;
  warnings?: string[];
}

export interface SelectorDiscoveryJob {
  id: string;
  url: string;
  normalizedUrl: string;
  hostname: string;
  status: 'queued' | 'known_adapter' | 'configuration_required' | 'running' | 'awaiting_review' | 'invalid' | 'failed';
  target?: 'full' | 'chapter-only';
  promotionMode?: 'create' | 'augment';
  baseAdapterId?: string;
  adapterId?: string;
  adapterName?: string;
  model?: string;
  aoBaseUrl?: string;
  phase?: 'known_adapter' | 'phase1' | 'phase2' | 'complete';
  createdAt: string;
  updatedAt: string;
  error?: string;
  phase1Markdown?: string;
  inputSource?: 'live-fetch' | 'html-snapshot';
  candidateMarkdown?: string;
  parsedCandidate?: ParsedMarkdownCandidate;
  validation?: MarkdownCandidateValidation;
  extractionValidation?: SelectorExtractionValidation;
  shadowPromotion?: SelectorDiscoveryShadowPromotion;
  oracleComparison?: SelectorDiscoveryOracleComparison;
}

export interface SelectorExtractionValidation {
  valid: boolean;
  checkedAt: string;
  metadata?: {
    title?: string;
    chapterCount: number;
    firstChapterUrl?: string;
  };
  images?: {
    chapterUrl: string;
    imageCount: number;
    firstImageUrl?: string;
  };
  errors: string[];
}

export interface SelectorDiscoveryOracleComparison {
  adapterId: string;
  adapterName: string;
  checkedAt: string;
  candidate: {
    title?: string;
    chapterCount: number;
    firstChapterUrl?: string;
    imageCount?: number;
    firstImageUrl?: string;
  };
  oracle: {
    title?: string;
    chapterCount: number;
    firstChapterUrl?: string;
    imageCount?: number;
    firstImageUrl?: string;
  };
  titleMatched: boolean;
  chapterCountDelta: number;
  imageCountDelta?: number;
  warnings: string[];
}

export interface SelectorDiscoveryShadowPromotion {
  id: string;
  jobId: string;
  createdAt: string;
  manifestAdapterId: string;
  manifestName: string;
  domains: string[];
  storageKey: string;
  note: string;
}

export interface MarkdownCandidateValidation {
  valid: boolean;
  missingHeadings: string[];
  warnings: string[];
}

export interface ParsedMarkdownCandidate {
  adapterId?: string;
  name?: string;
  domains: string[];
  urlPatterns: string[];
  selectors: Partial<SiteSelectors>;
  confidence?: string;
  rawSections: Record<string, string>;
}

export interface DiscoveryInput {
  url: string;
  target?: 'full' | 'chapter-only';
  aoBaseUrl?: string;
  providerDocument?: ProviderDocument;
  model?: string;
  forceDiscovery?: boolean;
  htmlSnapshot?: {
    html: string;
    finalUrl?: string;
    pageType?: 'chapter';
  };
}
