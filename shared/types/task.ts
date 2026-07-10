export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'waiting_verification'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskProgress {
  totalChapters: number;
  completedChapters: number;
  totalImages: number;
  completedImages: number;
  stage?: CrawlStage;
  stageDetail?: string;
  currentChapter?: string;
  currentImage?: number;
  failedImages: number;
  skippedImages: number;
  metadata?: Record<string, unknown>;
  chapterListSummary?: ChapterListSummary;
}

export type CrawlStage =
  | 'adapter'
  | 'verification'
  | 'metadata'
  | 'chapter_list'
  | 'chapter_images'
  | 'downloading'
  | 'completed'
  | 'failed';

export interface ChapterListSummary {
  totalChapters: number;
  chapters: Array<Pick<ChapterInfo, 'id' | 'title' | 'url'>>;
}

export interface TaskOptions {
  destPath: string;
  chapters?: string[];
  concurrency?: number;
  namingTemplate?: string;
  imageFormat?: ImageFormat;
  imageQuality?: number;
  parseMode?: 'static' | 'dynamic' | 'interactive';
}

export interface ChapterInfo {
  id: string;
  title: string;
  url: string;
  status?: TaskStatus;
  totalImages?: number;
  completedImages?: number;
  number?: number;
  date?: Date;
}

export interface Task {
  id: string;
  url: string;
  adapterId: string;
  status: TaskStatus;
  title?: string;
  author?: string;
  chapters: ChapterInfo[];
  progress: TaskProgress;
  options: TaskOptions;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface TaskFilter {
  status?: TaskStatus;
  adapterId?: string;
  limit?: number;
  offset?: number;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  totalImages: number;
  downloadedImages: number;
  failedImages: number;
  duration: number;
}

export type ImageFormat = 'original' | 'jpg' | 'png' | 'webp';

export interface CrawlOptions {
  destPath?: string;
  chapters?: string[];
  concurrency?: number;
  namingTemplate?: string;
  imageFormat?: ImageFormat;
  imageQuality?: number;
  parseMode?: 'static' | 'dynamic' | 'interactive';
}

export interface DownloadResult {
  url: string;
  path: string;
  status: 'success' | 'failed' | 'duplicate';
  error?: Error;
}
