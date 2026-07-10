import { create } from 'zustand';
import { api, getApiErrorMessage } from '../api/client';

export interface Task {
  id: string;
  url: string;
  mode?: 'all' | 'chapters';
  status: string;
  priority: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  progress?: {
    totalItems: number;
    completedItems: number;
    failedItems: number;
    percentage: number;
    stage?: CrawlStage;
    stageDetail?: string;
    currentItems?: string;
    metadata?: Record<string, unknown>;
    chapterListSummary?: ChapterListSummary;
  } | null;
  checkpoint?: {
    currentChapter?: string;
    completedImages: number;
    failedImages: number;
    resumable: boolean;
    updatedAt?: string;
  } | null;
}

export interface TaskDetail {
  task: Task;
  progress?: {
    totalItems: number;
    completedItems: number;
    failedItems: number;
    percentage: number;
    stage?: CrawlStage;
    stageDetail?: string;
    currentItems?: string;
    metadata?: Record<string, unknown>;
    chapterListSummary?: ChapterListSummary;
    startedAt?: string;
    updatedAt?: string;
  } | null;
  result?: {
    taskId: string;
    status: string;
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
  } | null;
  preview?: {
    rootDir: string;
    totalFiles: number;
    files: Array<{
      name: string;
      relativePath: string;
      size: number;
      modifiedAt: string;
      isImage?: boolean;
      url?: string;
    }>;
  } | null;
  checkpoint?: {
    currentChapter?: string;
    completedImages: number;
    failedImages: number;
    resumable: boolean;
    updatedAt?: string;
  } | null;
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
  chapters: Array<{
    id: string;
    title: string;
    url: string;
  }>;
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

export interface TaskRealtimeMessage {
  event?: string;
  data?: Record<string, unknown>;
}

export type CreateTaskResult =
  | { kind: 'taskCreated'; taskId: string }
  | {
      kind: 'discoveryQueued';
      discoveryId: string;
      status: string;
      normalizedUrl: string;
      target?: 'full' | 'chapter-only';
      reason?: string;
      adapterId?: string;
      adapterName?: string;
      requiredCapabilities?: { metadata?: boolean; chapterImages?: boolean };
      capabilities?: { verification?: boolean; metadata: boolean; chapterImages: boolean };
    }
  | {
      kind: 'challengeDiscoveryQueued';
      challengeDiscoveryId: string;
      status: string;
      normalizedUrl: string;
      reason?: string;
      requiredCapabilities?: { metadata?: boolean; chapterImages?: boolean };
    };

interface TaskState {
  tasks: Task[];
  stats: TaskStats | null;
  loading: boolean;
  error: string | null;

  fetchTasks: () => Promise<void>;
  applyRealtimeEvent: (message: TaskRealtimeMessage) => void;
  createTask: (url: string, options?: { adapterId?: string; mode?: 'all' | 'chapters'; chapters?: string[]; chapterUrls?: string[]; priority?: number }) => Promise<CreateTaskResult>;
  pauseTask: (id: string) => Promise<void>;
  resumeTask: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  clearError: () => void;
}

function calculateStats(tasks: Task[]): TaskStats {
  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === 'pending').length,
    running: tasks.filter((task) => task.status === 'running').length,
    waitingVerification: tasks.filter((task) => task.status === 'waiting_verification').length,
    interrupted: tasks.filter((task) => task.status === 'interrupted').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    cancelled: tasks.filter((task) => task.status === 'cancelled').length,
  };
}

function updateTask(tasks: Task[], taskId: string, updater: (task: Task) => Task): Task[] {
  return tasks.map((task) => (task.id === taskId ? updater(task) : task));
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  stats: null,
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getTasks();
      set({ tasks: response.data.tasks, stats: response.data.stats, loading: false });
    } catch (error: any) {
      set({ error: getApiErrorMessage(error), loading: false });
    }
  },

  applyRealtimeEvent: (message) => {
    const event = message.event;
    const data = message.data;
    if (!event || !data) {
      return;
    }

    set((state) => {
      let tasks = state.tasks;

      if (event === 'task:created') {
        const taskId = typeof data.taskId === 'string' ? data.taskId : null;
        const url = typeof data.url === 'string' ? data.url : '';

        if (taskId && !tasks.some((task) => task.id === taskId)) {
          tasks = [
            {
              id: taskId,
              url,
              mode: undefined,
              status: 'pending',
              priority: 0,
              createdAt: new Date().toISOString(),
              progress: null,
            },
            ...tasks,
          ];
        }
      }

      if (event === 'task:started' || event === 'task:paused' || event === 'task:resumed' || event === 'task:cancelled') {
        const taskId = typeof data.taskId === 'string' ? data.taskId : null;
        if (taskId) {
          const statusByEvent: Record<string, Task['status']> = {
            'task:started': 'running',
            'task:paused': 'paused',
            'task:resumed': 'pending',
            'task:cancelled': 'cancelled',
          };
          tasks = updateTask(tasks, taskId, (task) => ({
            ...task,
            status: statusByEvent[event] ?? task.status,
            completedAt: event === 'task:cancelled' ? new Date().toISOString() : task.completedAt,
          }));
        }
      }

      if (event === 'task:progress') {
        const taskId = typeof data.taskId === 'string' ? data.taskId : null;
        const progressData = data.progress as Record<string, unknown> | undefined;
        if (taskId && progressData) {
          const totalItems = typeof progressData.totalImages === 'number' ? progressData.totalImages : 0;
          const completedItems = typeof progressData.completedImages === 'number' ? progressData.completedImages : 0;
          const failedItems = typeof progressData.failedImages === 'number' ? progressData.failedImages : 0;
          const currentItems = typeof progressData.currentChapter === 'string' ? progressData.currentChapter : undefined;
          const stage = typeof progressData.stage === 'string' ? progressData.stage as CrawlStage : undefined;
          const stageDetail = typeof progressData.stageDetail === 'string' ? progressData.stageDetail : currentItems;
          const metadata = progressData.metadata && typeof progressData.metadata === 'object'
            ? progressData.metadata as Record<string, unknown>
            : undefined;
          const chapterListSummary = parseChapterListSummary(progressData.chapterListSummary);
          const percentage = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

          tasks = updateTask(tasks, taskId, (task) => ({
            ...task,
            status: task.status === 'pending' || task.status === 'paused' ? 'running' : task.status,
            progress: {
              totalItems,
              completedItems,
              failedItems,
              percentage,
              stage,
              stageDetail,
              currentItems,
              metadata,
              chapterListSummary,
            },
          }));
        }
      }

      if (event === 'task:completed') {
        const taskId = typeof data.taskId === 'string' ? data.taskId : null;
        const result = data.result as Record<string, unknown> | undefined;
        if (taskId) {
          const totalItems = typeof result?.totalImages === 'number' ? result.totalImages : 0;
          const completedItems = typeof result?.downloadedImages === 'number' ? result.downloadedImages : totalItems;
          const failedItems = typeof result?.failedImages === 'number' ? result.failedImages : 0;
          tasks = updateTask(tasks, taskId, (task) => ({
            ...task,
            status: 'completed',
            completedAt: new Date().toISOString(),
            progress: {
              totalItems,
              completedItems,
              failedItems,
              percentage: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 100,
              stage: 'completed',
              stageDetail: 'crawl completed',
              currentItems: task.progress?.currentItems,
            },
          }));
        }
      }

      if (event === 'task:waiting_verification') {
        const taskId = typeof data.taskId === 'string' ? data.taskId : null;
        const message = typeof data.message === 'string' ? data.message : undefined;
        if (taskId) {
          tasks = updateTask(tasks, taskId, (task) => ({
            ...task,
            status: 'waiting_verification',
            completedAt: undefined,
            error: message ?? task.error,
            progress: task.progress
              ? {
                  ...task.progress,
                  stage: 'verification',
                  stageDetail: message ?? task.progress.stageDetail,
                  currentItems: message ?? task.progress.currentItems,
                }
              : task.progress,
          }));
        }
      }

      if (event === 'task:failed') {
        const taskId = typeof data.taskId === 'string' ? data.taskId : null;
        const error = data.error as Record<string, unknown> | undefined;
        if (taskId) {
          tasks = updateTask(tasks, taskId, (task) => ({
            ...task,
            status: 'failed',
            completedAt: new Date().toISOString(),
            error: typeof error?.message === 'string' ? error.message : task.error,
            progress: task.progress ? { ...task.progress, stage: 'failed', stageDetail: typeof error?.message === 'string' ? error.message : task.progress.stageDetail } : task.progress,
          }));
        }
      }

      if (tasks === state.tasks) {
        return state;
      }

      return {
        tasks,
        stats: calculateStats(tasks),
      };
    });
  },

  createTask: async (url: string, options) => {
    set({ loading: true, error: null });
    try {
      const response = await api.createTask(url, options);
      if (response.data.kind === 'discoveryQueued' || response.data.kind === 'challengeDiscoveryQueued') {
        set({ loading: false });
        return response.data;
      }

      await get().fetchTasks();
      return {
        kind: 'taskCreated',
        taskId: response.data.taskId,
      };
    } catch (error: any) {
      set({ error: getApiErrorMessage(error), loading: false });
      throw error;
    }
  },

  pauseTask: async (id: string) => {
    try {
      await api.pauseTask(id);
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: getApiErrorMessage(error) });
    }
  },

  resumeTask: async (id: string) => {
    try {
      await api.resumeTask(id);
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: getApiErrorMessage(error) });
      await get().fetchTasks();
    }
  },

  cancelTask: async (id: string) => {
    try {
      await api.cancelTask(id);
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: getApiErrorMessage(error) });
    }
  },

  deleteTask: async (id: string) => {
    try {
      await api.deleteTask(id);
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: getApiErrorMessage(error) });
    }
  },

  clearError: () => set({ error: null }),
}));

function parseChapterListSummary(value: unknown): ChapterListSummary | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters
        .map((chapter) => {
          if (!chapter || typeof chapter !== 'object') return null;
          const item = chapter as Record<string, unknown>;
          return {
            id: typeof item.id === 'string' ? item.id : '',
            title: typeof item.title === 'string' ? item.title : '',
            url: typeof item.url === 'string' ? item.url : '',
          };
        })
        .filter((chapter): chapter is { id: string; title: string; url: string } => Boolean(chapter && chapter.url))
    : [];
  return {
    totalChapters: typeof raw.totalChapters === 'number' ? raw.totalChapters : chapters.length,
    chapters,
  };
}
