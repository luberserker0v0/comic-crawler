import type { AdapterCapabilities, AdapterInfo } from './adapter';
import type { GlobalConfig } from './config';
import type { TaskStatus } from './task';

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
  currentItems?: string;
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
  totalImages: number;
  resumable: boolean;
  updatedAt?: string;
  lastError?: string;
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
