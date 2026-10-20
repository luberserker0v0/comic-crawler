import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useTaskStore, type CrawlStage, type TaskDetail } from '../../store';
import { useWebSocket } from '../../hooks';
import { mergePreviewFile } from './widgets';
import { parseChapterListSummary } from '../../utils/chapter-summary';

type RealtimeMessage = { event?: string; data?: Record<string, unknown> };
export function useSelectedTask(selectedTaskId: string | null) {
  const state = useDetailState();
  const applyRealtimeEvent = useTaskStore((value) => value.applyRealtimeEvent);
  useInitialDetail(selectedTaskId, state);
  const refreshTaskDetail = (id: string) => refreshDetail(id, state);
  const handleMessage = (message: RealtimeMessage) => {
    handleRealtimeMessage(message, selectedTaskId, applyRealtimeEvent, state);
  };
  const connected = useTaskRealtime(handleMessage);
  return { detail: state.detail, setDetail: state.setDetail, detailLoading: state.detailLoading,
    detailError: state.detailError, setDetailError: state.setDetailError, refreshTaskDetail, connected };
}

function useDetailState() {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  return { detail, setDetail, detailLoading, setDetailLoading, detailError, setDetailError };
}

type DetailState = ReturnType<typeof useDetailState>;

function useInitialDetail(selectedTaskId: string | null, state: DetailState) {
  const { setDetail, setDetailError, setDetailLoading } = state;
  useEffect(() => {
    if (!selectedTaskId) return;
    let cancelled = false;
    void loadInitialDetail(selectedTaskId, { setDetail, setDetailError, setDetailLoading }, () => cancelled);
    return () => { cancelled = true; };
  }, [selectedTaskId, setDetail, setDetailError, setDetailLoading]);
}

type DetailSetters = Pick<DetailState, 'setDetail' | 'setDetailError' | 'setDetailLoading'>;

async function loadInitialDetail(id: string, state: DetailSetters, cancelled: () => boolean) {
  state.setDetailLoading(true);
  state.setDetailError(null);
  try {
    const response = await api.getTask(id);
    if (!cancelled()) state.setDetail(response.data);
  } catch (error: any) {
    if (!cancelled()) state.setDetailError(error.message);
  } finally {
    if (!cancelled()) state.setDetailLoading(false);
  }
}

async function refreshDetail(id: string, state: DetailSetters): Promise<TaskDetail | null> {
  state.setDetailLoading(true);
  state.setDetailError(null);
  try {
    const response = await api.getTask(id);
    state.setDetail(response.data);
    return response.data as TaskDetail;
  } catch (error: any) {
    state.setDetailError(error.response?.data?.error ?? error.message);
    return null;
  } finally {
    state.setDetailLoading(false);
  }
}

function handleRealtimeMessage(message: RealtimeMessage, selectedId: string | null,
  applyRealtimeEvent: ReturnType<typeof useTaskStore.getState>['applyRealtimeEvent'], state: DetailSetters) {
  if (!message.event?.startsWith('task:') && message.event !== 'image:downloaded') return;
  if (message.event.startsWith('task:')) applyRealtimeEvent(message);
  const taskId = typeof message.data?.taskId === 'string' ? message.data.taskId : null;
  if (!taskId || taskId !== selectedId) return;
  applyDetailEvent(message, taskId, state);
}

function applyDetailEvent(message: RealtimeMessage, taskId: string, state: DetailSetters) {
  if (message.event === 'image:downloaded') state.setDetail(
    (current) => mergePreviewFile(current, message.data?.previewFile));
  else if (message.event === 'task:metadata_extracted') state.setDetail(
    (current) => updateMetadata(current, message.data));
  else if (message.event === 'task:chapter_list_extracted') state.setDetail(
    (current) => updateChapterList(current, message.data));
  else if (message.event === 'task:progress') state.setDetail(
    (current) => updateProgress(current, message.data?.progress));
  else if (statusEvents.includes(message.event ?? '')) state.setDetail(
    (current) => updateTaskStatus(current, message.event!));
  else if (terminalEvents.includes(message.event ?? '')) void refreshDetail(taskId, state);
}

function updateMetadata(current: TaskDetail | null, data?: Record<string, unknown>): TaskDetail | null {
  if (!current) return current;
  const metadata = isRecord(data?.metadata) ? data!.metadata as Record<string, unknown> : undefined;
  const chapterListSummary = parseChapterListSummary(data?.chapterListSummary);
  return { ...current, result: { taskId: current.result?.taskId ?? current.task.id,
    status: current.result?.status ?? current.task.status, downloadedImages: current.result?.downloadedImages ?? 0,
    failedImages: current.result?.failedImages ?? 0, totalImages: current.result?.totalImages ?? 0,
    ...current.result, ...(metadata ? { metadata } : {}) },
  progress: createProgress(current, 'metadata', 'metadata extracted', metadata, chapterListSummary) };
}

function updateChapterList(current: TaskDetail | null, data?: Record<string, unknown>): TaskDetail | null {
  if (!current) return current;
  const summary = parseChapterListSummary(data?.chapterListSummary);
  if (!summary) return current;
  return { ...current, progress: createProgress(current, 'chapter_list', 'chapter list extracted', undefined, summary) };
}

function createProgress(current: TaskDetail, stage: CrawlStage, stageDetail: string,
  metadata?: Record<string, unknown>, chapterListSummary?: ReturnType<typeof parseChapterListSummary>) {
  return { totalItems: current.progress?.totalItems ?? 0, completedItems: current.progress?.completedItems ?? 0,
    failedItems: current.progress?.failedItems ?? 0, percentage: current.progress?.percentage ?? 0,
    ...current.progress, stage: current.progress?.stage ?? stage,
    stageDetail: current.progress?.stageDetail ?? stageDetail, ...(metadata ? { metadata } : {}),
    ...(chapterListSummary ? { chapterListSummary } : {}) };
}

function updateProgress(current: TaskDetail | null, value: unknown): TaskDetail | null {
  if (!current || !isRecord(value)) return current;
  const parsed = parseProgress(value);
  const now = new Date().toISOString();
  return { ...current, task: { ...current.task,
    status: ['pending', 'paused'].includes(current.task.status) ? 'running' : current.task.status },
  progress: { ...parsed, startedAt: current.progress?.startedAt ?? current.task.startedAt ?? now, updatedAt: now },
  result: parsed.metadata ? updateResult(current, parsed.metadata, value.outputPath) : current.result };
}

function parseProgress(data: Record<string, unknown>) {
  const totalItems = numberValue(data.totalImages), completedItems = numberValue(data.completedImages);
  const failedItems = numberValue(data.failedImages);
  const currentItems = typeof data.currentChapter === 'string' ? data.currentChapter : undefined;
  const stage = typeof data.stage === 'string' ? data.stage as CrawlStage : undefined;
  const metadata = isRecord(data.metadata) ? data.metadata as Record<string, unknown> : undefined;
  const chapterListSummary = parseChapterListSummary(data.chapterListSummary);
  return { totalItems, completedItems, failedItems, percentage: totalItems > 0 ? Math.round(completedItems / totalItems * 100) : 0,
    stage, stageDetail: typeof data.stageDetail === 'string' ? data.stageDetail : currentItems, currentItems,
    ...(metadata ? { metadata } : {}), ...(chapterListSummary ? { chapterListSummary } : {}) };
}

function updateResult(current: TaskDetail, metadata: Record<string, unknown>, outputPath: unknown) {
  return { taskId: current.result?.taskId ?? current.task.id, status: current.result?.status ?? current.task.status,
    downloadedImages: current.result?.downloadedImages ?? 0, failedImages: current.result?.failedImages ?? 0,
    totalImages: current.result?.totalImages ?? 0, ...current.result, metadata,
    ...(typeof outputPath === 'string' ? { outputPath } : {}) };
}

const statusEvents = ['task:started', 'task:paused', 'task:resumed', 'task:cancelled'];
const terminalEvents = ['task:completed', 'task:failed', 'task:waiting_verification'];

function updateTaskStatus(current: TaskDetail | null, event: string): TaskDetail | null {
  if (!current) return current;
  const statuses: Record<string, TaskDetail['task']['status']> = { 'task:started': 'running',
    'task:paused': 'paused', 'task:resumed': 'pending', 'task:cancelled': 'cancelled' };
  return { ...current, task: { ...current.task, status: statuses[event] ?? current.task.status,
    completedAt: event === 'task:cancelled' ? new Date().toISOString() : current.task.completedAt } };
}

function numberValue(value: unknown) { return typeof value === 'number' ? value : 0; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

const taskEvents = ['task:created', 'task:started', 'task:progress', 'task:metadata_extracted',
  'task:chapter_list_extracted', 'task:paused', 'task:resumed', 'task:waiting_verification',
  'task:completed', 'task:failed', 'task:cancelled', 'image:downloaded'];

function useTaskRealtime(onMessage: (message: RealtimeMessage) => void) {
  const wsUrl = typeof window === 'undefined' ? ''
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
  const { connected, subscribe, unsubscribe } = useWebSocket(wsUrl, onMessage);
  useEffect(() => {
    if (!connected) return;
    taskEvents.forEach((event) => subscribe(event));
    return () => taskEvents.forEach((event) => unsubscribe(event));
  }, [connected, subscribe, unsubscribe]);
  return connected;
}
