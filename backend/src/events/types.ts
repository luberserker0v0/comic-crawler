import type { ChapterListSummary, CrawlStage, TaskPreviewFile } from '@comiccrawler/shared';

export interface EventMap {
  'task:created': { taskId: string; url: string };
  'task:started': { taskId: string };
  'task:progress': { taskId: string; progress: TaskProgress };
  'task:metadata_extracted': { taskId: string; metadata: Record<string, unknown>; chapterListSummary?: ChapterListSummary };
  'task:chapter_list_extracted': { taskId: string; chapterListSummary: ChapterListSummary };
  'task:paused': { taskId: string };
  'task:resumed': { taskId: string };
  'task:waiting_verification': { taskId: string; challengeDiscoveryId: string; challengeStatus?: string; message: string };
  'task:completed': { taskId: string; result: unknown };
  'task:failed': { taskId: string; error: Error };
  'task:cancelled': { taskId: string };

  'image:downloaded': { taskId: string; imageUrl: string; path: string; previewFile?: TaskPreviewFile };
  'image:failed': { taskId: string; imageUrl: string; error: Error };
  'image:duplicate': { taskId: string; imageUrl: string };
  'chapter:completed': { taskId: string; chapterId: string };

  'adapter:registered': { adapterId: string };
  'config:changed': { key: string; value: unknown };
  'scheduler:triggered': { scheduleId: string };
  'adapter:repair:triggered': { adapterId: string; triggerKey: string; count: number };
  'adapter:repair:started': { adapterId: string; sessionId: string };
  'adapter:repair:attempted': { adapterId: string; sessionId: string; attempt: number };
  'adapter:repair:validated': { adapterId: string; sessionId: string; valid: boolean };
  'adapter:repair:candidate-created': { adapterId: string; sessionId: string; version: string };
  'adapter:repair:promotion-requested': { adapterId: string; sessionId: string; version: string };
  'adapter:repair:promoted': { adapterId: string; version: string };
  'adapter:repair:failed': { adapterId: string; sessionId: string; error: string };
  'adapter:repair:rolled-back': { adapterId: string; fromVersion?: string; toVersion: string };
}

export interface TaskProgress {
  totalImages: number;
  completedImages: number;
  failedImages: number;
  stage?: CrawlStage;
  stageDetail?: string;
  currentChapter?: string;
  metadata?: Record<string, unknown>;
  chapterListSummary?: ChapterListSummary;
  outputPath?: string;
}

export type EventKey = keyof EventMap;
export type EventHandler<K extends EventKey> = (payload: EventMap[K]) => void | Promise<void>;

export interface Subscription {
  unsubscribe(): void;
}
