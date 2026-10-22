import { create, type StateCreator } from 'zustand';
import { api, getApiErrorMessage } from '../api/client';
import { parseChapterListSummary } from '../utils/chapter-summary';

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
  progress?: TaskProgress | null;
  checkpoint?: TaskCheckpoint | null;
}

interface TaskProgress {
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
}

interface TaskCheckpoint {
  currentChapter?: string;
  completedImages: number;
  failedImages: number;
  resumable: boolean;
  updatedAt?: string;
}

export interface TaskDetail {
  task: Task;
  progress?: TaskProgress | null;
  result?: TaskResult | null;
  preview?: TaskPreview | null;
  checkpoint?: TaskCheckpoint | null;
}

interface TaskResult {
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
}

interface TaskPreview {
  rootDir: string;
  totalFiles: number;
  files: Array<{ name: string; relativePath: string; size: number; modifiedAt: string; isImage?: boolean; url?: string }>;
}

export type CrawlStage = 'adapter' | 'verification' | 'metadata' | 'chapter_list'
  | 'chapter_images' | 'downloading' | 'completed' | 'failed';

export interface ChapterListSummary {
  totalChapters: number;
  chapters: Array<{ id: string; title: string; url: string }>;
}

export interface TaskStats {
  total: number;
  pending: number;
  running: number;
  waitingForBrowserWorker: number;
  waitingVerification: number;
  interrupted: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface TaskRealtimeMessage { event?: string; data?: Record<string, unknown> }

export type CreateTaskResult = { kind: 'taskCreated'; taskId: string } | DiscoveryQueued | ChallengeDiscoveryQueued;

interface DiscoveryQueued {
  kind: 'discoveryQueued'; discoveryId: string; status: string; normalizedUrl: string;
  target?: 'full' | 'chapter-only'; reason?: string; adapterId?: string; adapterName?: string;
  requiredCapabilities?: { metadata?: boolean; chapterImages?: boolean };
  capabilities?: { verification?: boolean; metadata: boolean; chapterImages: boolean };
}

interface ChallengeDiscoveryQueued {
  kind: 'challengeDiscoveryQueued'; challengeDiscoveryId: string; status: string; normalizedUrl: string;
  reason?: string; requiredCapabilities?: { metadata?: boolean; chapterImages?: boolean };
}

interface TaskState {
  tasks: Task[]; stats: TaskStats | null; loading: boolean; error: string | null;
  fetchTasks(): Promise<void>;
  applyRealtimeEvent(message: TaskRealtimeMessage): void;
  createTask(url: string, options?: CreateTaskOptions): Promise<CreateTaskResult>;
  pauseTask(id: string): Promise<void>;
  resumeTask(id: string): Promise<void>;
  cancelTask(id: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  clearError(): void;
}

interface CreateTaskOptions {
  adapterId?: string; mode?: 'all' | 'chapters'; chapters?: string[]; chapterUrls?: string[]; priority?: number;
  browserTarget?: { mode: 'managed-profile'; workerId?: string }
    | { mode: 'existing-tab'; workerId: string; resourceId: string };
}

type StoreSet = Parameters<StateCreator<TaskState>>[0];
type StoreGet = Parameters<StateCreator<TaskState>>[1];

export const useTaskStore = create<TaskState>((set, get) => createTaskState(set, get));

function createTaskState(set: StoreSet, get: StoreGet): TaskState {
  return { tasks: [], stats: null, loading: false, error: null,
    fetchTasks: createFetchTasks(set), applyRealtimeEvent: createRealtimeHandler(set),
    createTask: createTaskCreator(set, get),
    pauseTask: createTaskCommand(set, get, api.pauseTask),
    resumeTask: createTaskCommand(set, get, api.resumeTask, true),
    cancelTask: createTaskCommand(set, get, api.cancelTask),
    deleteTask: createTaskCommand(set, get, api.deleteTask),
    clearError: () => set({ error: null }) };
}

function calculateStats(tasks: Task[]): TaskStats {
  const count = (status: string) => tasks.filter((task) => task.status === status).length;
  return { total: tasks.length, pending: count('pending'), running: count('running'),
    waitingForBrowserWorker: count('waiting_for_browser_worker'), waitingVerification: count('waiting_verification'),
    interrupted: count('interrupted'), completed: count('completed'), failed: count('failed'), cancelled: count('cancelled') };
}

function updateTask(tasks: Task[], taskId: string, updater: (task: Task) => Task): Task[] {
  return tasks.map((task) => task.id === taskId ? updater(task) : task);
}

function createFetchTasks(set: StoreSet) {
  return async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getTasks();
      set({ tasks: response.data.tasks, stats: response.data.stats, loading: false });
    } catch (error) {
      set({ error: getApiErrorMessage(error), loading: false });
    }
  };
}

function createRealtimeHandler(set: StoreSet) {
  return (message: TaskRealtimeMessage) => {
    if (!message.event || !message.data) return;
    set((state) => reduceRealtimeState(state, message.event!, message.data!));
  };
}

function reduceRealtimeState(state: TaskState, event: string, data: Record<string, unknown>): Partial<TaskState> {
  const tasks = reduceTasks(state.tasks, event, data);
  if (tasks === state.tasks) return state;
  return { tasks, stats: calculateStats(tasks) };
}

function reduceTasks(tasks: Task[], event: string, data: Record<string, unknown>): Task[] {
  if (event === 'task:created') return addCreatedTask(tasks, data);
  if (statusEvents.includes(event)) return updateStatusEvent(tasks, event, data);
  if (event === 'task:progress') return updateProgressEvent(tasks, data);
  if (event === 'task:completed') return updateCompletedEvent(tasks, data);
  if (event === 'task:waiting_verification') return updateWaitingVerification(tasks, data);
  if (event === 'task:waiting_for_browser_worker') return updateWaitingWorker(tasks, data);
  if (event === 'task:failed') return updateFailedEvent(tasks, data);
  return tasks;
}

function addCreatedTask(tasks: Task[], data: Record<string, unknown>) {
  const taskId = stringValue(data.taskId), url = stringValue(data.url) ?? '';
  if (!taskId || tasks.some((task) => task.id === taskId)) return tasks;
  return [{ id: taskId, url, mode: undefined, status: 'pending', priority: 0,
    createdAt: new Date().toISOString(), progress: null }, ...tasks];
}

const statusEvents = ['task:started', 'task:paused', 'task:resumed', 'task:cancelled'];

function updateStatusEvent(tasks: Task[], event: string, data: Record<string, unknown>) {
  const taskId = stringValue(data.taskId);
  if (!taskId) return tasks;
  const statuses: Record<string, string> = { 'task:started': 'running', 'task:paused': 'paused',
    'task:resumed': 'pending', 'task:cancelled': 'cancelled' };
  return updateTask(tasks, taskId, (task) => ({ ...task, status: statuses[event] ?? task.status,
    completedAt: event === 'task:cancelled' ? new Date().toISOString() : task.completedAt }));
}

function updateProgressEvent(tasks: Task[], data: Record<string, unknown>) {
  const taskId = stringValue(data.taskId), progress = recordValue(data.progress);
  if (!taskId || !progress) return tasks;
  const parsed = parseTaskProgress(progress);
  return updateTask(tasks, taskId, (task) => ({ ...task,
    status: ['pending', 'paused'].includes(task.status) ? 'running' : task.status, progress: parsed }));
}

function parseTaskProgress(data: Record<string, unknown>): TaskProgress {
  const totalItems = numberValue(data.totalImages), completedItems = numberValue(data.completedImages);
  const currentItems = stringValue(data.currentChapter), stage = stringValue(data.stage) as CrawlStage | undefined;
  const metadata = recordValue(data.metadata), chapterListSummary = parseChapterListSummary(data.chapterListSummary);
  return { totalItems, completedItems, failedItems: numberValue(data.failedImages),
    percentage: totalItems > 0 ? Math.round(completedItems / totalItems * 100) : 0,
    stage, stageDetail: stringValue(data.stageDetail) ?? currentItems, currentItems,
    ...(metadata ? { metadata } : {}), ...(chapterListSummary ? { chapterListSummary } : {}) };
}

function updateCompletedEvent(tasks: Task[], data: Record<string, unknown>) {
  const taskId = stringValue(data.taskId), result = recordValue(data.result);
  if (!taskId) return tasks;
  const totalItems = numberValue(result?.totalImages);
  const completedItems = typeof result?.downloadedImages === 'number' ? result.downloadedImages : totalItems;
  const failedItems = numberValue(result?.failedImages);
  return updateTask(tasks, taskId, (task) => ({ ...task, status: 'completed', completedAt: new Date().toISOString(),
    progress: { totalItems, completedItems, failedItems,
      percentage: totalItems > 0 ? Math.round(completedItems / totalItems * 100) : 100,
      stage: 'completed', stageDetail: 'crawl completed', currentItems: task.progress?.currentItems } }));
}

function updateWaitingVerification(tasks: Task[], data: Record<string, unknown>) {
  const taskId = stringValue(data.taskId), message = stringValue(data.message);
  if (!taskId) return tasks;
  return updateTask(tasks, taskId, (task) => ({ ...task, status: 'waiting_verification', completedAt: undefined,
    error: message ?? task.error, progress: task.progress ? { ...task.progress, stage: 'verification',
      stageDetail: message ?? task.progress.stageDetail, currentItems: message ?? task.progress.currentItems } : task.progress }));
}

function updateWaitingWorker(tasks: Task[], data: Record<string, unknown>) {
  const taskId = stringValue(data.taskId), message = stringValue(data.message);
  if (!taskId) return tasks;
  return updateTask(tasks, taskId, (task) => ({ ...task, status: 'waiting_for_browser_worker',
    completedAt: undefined, error: message }));
}

function updateFailedEvent(tasks: Task[], data: Record<string, unknown>) {
  const taskId = stringValue(data.taskId), error = recordValue(data.error), message = stringValue(error?.message);
  if (!taskId) return tasks;
  return updateTask(tasks, taskId, (task) => ({ ...task, status: 'failed', completedAt: new Date().toISOString(),
    error: message ?? task.error, progress: task.progress ? { ...task.progress, stage: 'failed',
      stageDetail: message ?? task.progress.stageDetail } : task.progress }));
}

function createTaskCreator(set: StoreSet, get: StoreGet) {
  return async (url: string, options?: CreateTaskOptions): Promise<CreateTaskResult> => {
    set({ loading: true, error: null });
    try {
      const response = await api.createTask(url, options);
      if (response.data.kind !== 'taskCreated') { set({ loading: false }); return response.data; }
      await get().fetchTasks();
      return { kind: 'taskCreated', taskId: response.data.taskId };
    } catch (error) {
      set({ error: getApiErrorMessage(error), loading: false });
      throw error;
    }
  };
}

function createTaskCommand(set: StoreSet, get: StoreGet, command: (id: string) => Promise<unknown>, refreshOnError = false) {
  return async (id: string) => {
    try {
      await command(id);
      await get().fetchTasks();
    } catch (error) {
      set({ error: getApiErrorMessage(error) });
      if (refreshOnError) await get().fetchTasks();
    }
  };
}

function stringValue(value: unknown) { return typeof value === 'string' ? value : undefined; }
function numberValue(value: unknown) { return typeof value === 'number' ? value : 0; }
function recordValue(value: unknown) { return value && typeof value === 'object' ? value as Record<string, unknown> : undefined; }
