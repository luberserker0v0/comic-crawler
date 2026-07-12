import type { AdapterCapabilities, AdapterInfo } from './adapter';
import type { GlobalConfig } from './config';
import type { ChapterListSummary, CrawlStage, TaskStatus } from './task';

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface ApiErrorResponse {
  error: string;
  data?: unknown;
}

export type CrawlMode = 'all' | 'chapters';

export interface AdapterResolveRequest {
  url: string;
  mode?: CrawlMode;
}

export interface AdapterResolveResponse {
  url: string;
  hostname: string;
  mode: CrawlMode;
  requiredCapabilities: Partial<Pick<AdapterCapabilities, 'metadata' | 'chapterImages'>>;
  status: 'matched' | 'capability_mismatch' | 'not_found';
  adapter?: Pick<AdapterInfo, 'id' | 'name' | 'domains' | 'parseMode' | 'capabilities'>;
  matchedAdapter?: Pick<AdapterInfo, 'id' | 'name' | 'domains' | 'parseMode' | 'capabilities'>;
  discoveryTarget: SelectorDiscoveryTarget;
}

export interface AdapterListItem {
  id: string;
  name: string;
  domains: string[];
  capabilities: AdapterCapabilities;
}

export type AdapterFunctionCapability = 'common' | 'verification' | 'metadata' | 'chapterImages';
export type AdapterFunctionInputKind = 'url' | 'mangaUrl' | 'chapterUrl';

export interface AdapterFunctionDescriptor {
  id: string;
  label: string;
  capability: AdapterFunctionCapability;
  implemented: boolean;
  inputKind: AdapterFunctionInputKind;
  notes: string;
}

export interface AdapterCapabilityDetailResponse {
  adapter: Pick<AdapterInfo, 'id' | 'name' | 'domains' | 'parseMode' | 'capabilities'>;
  functions: AdapterFunctionDescriptor[];
}

export interface AdapterFunctionSourceResponse {
  adapterId: string;
  functionId: string;
  language: 'typescript' | 'json' | 'markdown';
  sourceKind: 'builtin-source' | 'dynamic-manifest' | 'pipeline-summary';
  source: string;
  notes: string;
}

export type AdapterImplementationSourceType = 'built-in' | 'dynamic' | 'summary';
export type AdapterImplementationSymbolKind = 'class' | 'method' | 'helper' | 'manifest-section';

export interface AdapterImplementationSymbol {
  id: string;
  label: string;
  capability?: AdapterFunctionCapability;
  kind: AdapterImplementationSymbolKind;
  startLine?: number;
  endLine?: number;
}

export interface AdapterImplementationResponse {
  adapterId: string;
  sourceType: AdapterImplementationSourceType;
  language: 'typescript' | 'json' | 'markdown';
  filePath?: string;
  content: string;
  outline: AdapterImplementationSymbol[];
  notes: string;
}

export type AdapterDraftSourceKind = 'built-in-source' | 'dynamic-manifest';
export type AdapterDraftStatus = 'editing' | 'testing' | 'ready_for_review' | 'promoted' | 'discarded';

export interface AdapterDraftSummary {
  draftId: string;
  baseAdapterId: string;
  baseAdapterName: string;
  sourceKind: AdapterDraftSourceKind;
  language: 'typescript' | 'json';
  status: AdapterDraftStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdapterDraftDetailResponse {
  draft: AdapterDraftSummary;
  language: 'typescript' | 'json';
  content: string;
}

export interface AdapterDraftListResponse {
  drafts: AdapterDraftSummary[];
}

export interface CreateAdapterDraftResponse extends AdapterDraftDetailResponse {}

export interface SaveAdapterDraftContentRequest {
  content: string;
}

export interface AdapterFunctionTestRequest {
  url: string;
  challengeDiscoveryId?: string;
}

export interface CompleteHumanVerificationRequest {
  settle?: boolean;
  allowNavigate?: boolean;
}

export type AdapterFunctionTestStatus = 'passed' | 'failed' | 'verification_required';

export type AdapterDomSource = 'static' | 'rendered' | 'verified-fixture' | 'handoff-required';
export type DomReadinessStatus =
  | 'ready'
  | 'human_verification_required'
  | 'needs_fixture_or_manual_review'
  | 'failed';
export type DomReadinessTarget = 'metadata' | 'chapterImages' | 'verification' | 'common';
export type AdapterFunctionRecommendedAction =
  | 'continue'
  | 'human_verification_handoff'
  | 'capture_verified_fixture'
  | 'manual_review';

export interface DomReadinessReport {
  status: DomReadinessStatus;
  target: DomReadinessTarget;
  confidence: number;
  reasons: string[];
  recommendedAction: AdapterFunctionRecommendedAction;
}

export interface FixtureSummary {
  id: string;
  domain: string;
  url: string;
  title: string;
  htmlLength: number;
  capturedAt: string;
  path: string;
  readiness: DomReadinessReport;
}

export interface AdapterFunctionTestResponse {
  ok: boolean;
  status: AdapterFunctionTestStatus;
  adapterId: string;
  functionId: string;
  durationMs: number;
  domSource: AdapterDomSource;
  readiness: DomReadinessReport;
  recommendedAction: AdapterFunctionRecommendedAction;
  fixtureId?: string;
  fixturePath?: string;
  resultSummary?: Record<string, unknown>;
  error?: string;
  requiresVerification: boolean;
  challengeDiscoveryId?: string;
  retryableAfterVerification?: boolean;
  verificationMessage?: string;
}

export interface DomReadinessCheckRequest {
  url: string;
  html: string;
  target: DomReadinessTarget;
  functionId?: string;
}

export interface DomReadinessCheckResponse {
  url: string;
  readiness: DomReadinessReport;
}

export interface FixtureCaptureRequest {
  challengeDiscoveryId: string;
  target: DomReadinessTarget;
  functionId?: string;
  expectedUrl?: string;
  settle?: boolean;
  expandCatalog?: boolean;
  allowNavigate?: boolean;
}

export interface FixtureCaptureResponse {
  fixture: FixtureSummary;
}

export interface FixtureDetailResponse {
  fixture: FixtureSummary;
  html?: string;
}

export interface FixtureFunctionTestRequest {
  adapterId: string;
  functionId: string;
}

export interface CreateTaskRequest {
  url: string;
  adapterId?: string;
  mode?: CrawlMode;
  chapters?: string[];
  chapterUrls?: string[];
  priority?: number;
}

export type CreateTaskResponse =
  | {
      kind: 'taskCreated';
      taskId: string;
    }
  | {
      kind: 'discoveryQueued';
      reason: 'adapter_not_found' | 'adapter_capability_mismatch';
      discoveryId: string;
      status: string;
      normalizedUrl: string;
      target?: SelectorDiscoveryTarget;
      adapterId?: string;
      adapterName?: string;
      requiredCapabilities: Partial<Pick<AdapterCapabilities, 'metadata' | 'chapterImages'>>;
      capabilities?: AdapterCapabilities;
    }
  | {
      kind: 'challengeDiscoveryQueued';
      reason: 'browser_challenge';
      challengeDiscoveryId: string;
      status: string;
      normalizedUrl: string;
      requiredCapabilities: Partial<Pick<AdapterCapabilities, 'metadata' | 'chapterImages'>>;
    };

export interface TaskListResponse {
  tasks: TaskSummary[];
  stats: TaskStats;
}

export interface TaskStats {
  total: number;
  pending: number;
  running: number;
  waitingVerification: number;
  interrupted: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface TaskSummary {
  id: string;
  url: string;
  mode?: CrawlMode;
  status: TaskStatus | 'interrupted';
  priority: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  progress: TaskProgressSummary | null;
  checkpoint: CrawlCheckpointSummary | null;
}

export interface TaskDetailResponse {
  task: Omit<TaskSummary, 'progress' | 'checkpoint'>;
  progress: TaskProgressSummary | null;
  result?: TaskResultSummary;
  checkpoint: CrawlCheckpointSummary | null;
  preview: TaskPreview | null;
}

export interface TaskProgressSummary {
  totalItems: number;
  completedItems: number;
  failedItems: number;
  percentage: number;
  stage?: CrawlStage;
  stageDetail?: string;
  currentItems?: string;
  metadata?: Record<string, unknown>;
  chapterListSummary?: ChapterListSummary;
}

export interface TaskResultSummary {
  taskId: string;
  status: TaskStatus | 'interrupted';
  metadata?: Record<string, unknown>;
  downloadedImages: number;
  failedImages: number;
  totalImages: number;
  outputPath?: string;
  error?: string;
  challengeDiscoveryId?: string;
  challengeStatus?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CrawlCheckpointSummary {
  currentChapter?: string;
  completedImages: number;
  failedImages: number;
  resumable: boolean;
  updatedAt?: string;
}

export interface TaskPreview {
  rootDir: string;
  totalFiles: number;
  files: TaskPreviewFile[];
}

export interface TaskPreviewFile {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
  isImage: boolean;
  url?: string;
}

export interface TaskPriorityOrderResponse {
  taskIds: string[];
}

export interface MessageResponse {
  message: string;
}

export type SelectorDiscoveryTarget = 'full' | 'chapter-only';

export interface SelectorDiscoveryConfigRequest {
  aoBaseUrl: string;
  providerDocument: unknown;
  model: string;
}

export interface SelectorDiscoverySettingsSummary {
  configured: boolean;
  aoBaseUrl?: string;
  model?: string;
  providerIds: string[];
  modelIds: string[];
  fingerprint?: string;
}

export interface CreateSelectorDiscoveryRequest {
  url: string;
  target?: SelectorDiscoveryTarget;
  forceDiscovery?: boolean;
}

export interface CreateSelectorDiscoverySnapshotRequest extends CreateSelectorDiscoveryRequest {
  html: string;
  finalUrl?: string;
  target?: 'chapter-only';
}

export interface SelectorDiscoveryJobSummary {
  id: string;
  url: string;
  normalizedUrl: string;
  hostname: string;
  status: string;
  target?: SelectorDiscoveryTarget;
  promotionMode?: 'create' | 'augment';
  baseAdapterId?: string;
  createdAt: string;
  updatedAt: string;
  candidateMarkdown?: string;
  validation?: unknown;
  error?: string;
  adapterId?: string;
  adapterName?: string;
}

export interface ChallengeHandoffJobSummary {
  id: string;
  url?: string;
  normalizedUrl: string;
  hostname?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  error?: string;
}

export interface OpenVerificationBrowserRequest {
  executablePath?: string;
  profileId?: string;
}

export type ConfigResponse = GlobalConfig;
