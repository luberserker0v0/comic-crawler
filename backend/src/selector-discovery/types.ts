export const DEFAULT_SELECTOR_DISCOVERY_MODEL = 'opencode/big-pickle';
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
  status: 'queued' | 'known_adapter' | 'configuration_required' | 'running' | 'awaiting_review' | 'promoted' | 'invalid' | 'failed';
  target?: 'full' | 'chapter-only';
  promotionMode?: 'create' | 'augment';
  baseAdapterId?: string;
  adapterId?: string;
  adapterName?: string;
  model?: string;
  aoBaseUrl?: string;
  stopAfterStage?: SelectorDiscoveryCapabilityStage;
  phase?: 'known_adapter' | 'phase1' | 'phase2' | SelectorDiscoveryCapabilityStage | 'compose' | 'complete';
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  promotedVersion?: string;
  artifactsCleanedAt?: string;
  error?: string;
  retriedFromId?: string;
  phase1Markdown?: string;
  inputSource?: 'live-fetch' | 'html-snapshot';
  capabilityDrafts?: SelectorDiscoveryCapabilityDraft[];
  adapterImplementationTs?: string;
  reviewNotesMarkdown?: string;
  functionRevisionTasks?: SelectorDiscoveryFunctionRevisionTask[];
  implementationValidation?: AdapterImplementationValidation;
  ownerUserId?: string;
  browserTarget?: { mode: 'managed-profile'; workerId?: string } | { mode: 'existing-tab'; workerId: string; resourceId: string };
  browserSessionId?: string;
}

export interface SelectorDiscoveryFunctionRevisionTask {
  id: string;
  parentDiscoveryId: string;
  functionId: string;
  instruction: string;
  status: 'queued' | 'running' | 'awaiting_review' | 'failed';
  model?: string;
  aoBaseUrl?: string;
  conversationId?: string;
  selfCheckMarkdown?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface AdapterImplementationValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  syntaxValid: boolean;
}

export type SelectorDiscoveryCapabilityStage =
  | 'common-verification'
  | 'metadata'
  | 'chapter-images';

export interface SelectorDiscoveryCapabilityDraft {
  stage: SelectorDiscoveryCapabilityStage;
  sourcePath: string;
  reviewPath: string;
  sourceTs?: string;
  reviewMarkdown?: string;
  validation?: AdapterImplementationValidation;
}

export interface DiscoveryInput {
  url: string;
  target?: 'full' | 'chapter-only';
  aoBaseUrl?: string;
  providerDocument?: ProviderDocument;
  model?: string;
  forceDiscovery?: boolean;
  stopAfterStage?: SelectorDiscoveryCapabilityStage;
  htmlSnapshot?: {
    html: string;
    finalUrl?: string;
    pageType?: 'chapter';
  };
  ownerUserId?: string;
  browserTarget?: { mode: 'managed-profile'; workerId?: string } | { mode: 'existing-tab'; workerId: string; resourceId: string };
  browserSessionId?: string;
}
