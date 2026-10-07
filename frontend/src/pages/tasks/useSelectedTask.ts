import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useTaskStore, type CrawlStage, type TaskDetail } from '../../store';
import { useWebSocket } from '../../hooks';
import { mergePreviewFile } from './widgets';
import { parseChapterListSummary } from '../../utils/chapter-summary';

export function useSelectedTask(selectedTaskId: string | null) {
  const applyRealtimeEvent = useTaskStore((state) => state.applyRealtimeEvent);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }

    let cancelled = false;
    const loadDetail = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const response = await api.getTask(selectedTaskId);
        if (!cancelled) {
          setDetail(response.data);
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setDetailError(loadError.message);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  const refreshTaskDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await api.getTask(id);
      setDetail(response.data);
      return response.data as TaskDetail;
    } catch (loadError: any) {
      setDetailError(loadError.response?.data?.error ?? loadError.message);
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleRealtimeMessage = useCallback((message: { event?: string; data?: Record<string, unknown> }) => {
    if (!message.event?.startsWith('task:') && message.event !== 'image:downloaded') {
      return;
    }

    if (message.event.startsWith('task:')) {
      applyRealtimeEvent(message);
    }

    const eventTaskId = typeof message.data?.taskId === 'string' ? message.data.taskId : null;
    if (!eventTaskId || eventTaskId !== selectedTaskId) {
      return;
    }

    if (message.event === 'image:downloaded') {
      setDetail((current) => mergePreviewFile(current, message.data?.previewFile));
      return;
    }

    if (message.event === 'task:metadata_extracted') {
      const metadata = message.data?.metadata && typeof message.data.metadata === 'object'
        ? message.data.metadata as Record<string, unknown>
        : undefined;
      const chapterListSummary = parseChapterListSummary(message.data?.chapterListSummary);
      setDetail((current) => current ? ({
        ...current,
        result: {
          taskId: current.result?.taskId ?? current.task.id,
          status: current.result?.status ?? current.task.status,
          downloadedImages: current.result?.downloadedImages ?? 0,
          failedImages: current.result?.failedImages ?? 0,
          totalImages: current.result?.totalImages ?? 0,
          ...current.result,
          ...(metadata ? { metadata } : {}),
        },
        progress: current.progress ? {
          ...current.progress,
          stage: current.progress.stage ?? 'metadata',
          stageDetail: current.progress.stageDetail ?? 'metadata extracted',
          ...(metadata ? { metadata } : {}),
          ...(chapterListSummary ? { chapterListSummary } : {}),
        } : {
          totalItems: 0,
          completedItems: 0,
          failedItems: 0,
          percentage: 0,
          stage: 'metadata',
          stageDetail: 'metadata extracted',
          ...(metadata ? { metadata } : {}),
          ...(chapterListSummary ? { chapterListSummary } : {}),
        },
      }) : current);
      return;
    }

    if (message.event === 'task:chapter_list_extracted') {
      const chapterListSummary = parseChapterListSummary(message.data?.chapterListSummary);
      if (!chapterListSummary) {
        return;
      }
      setDetail((current) => current ? ({
        ...current,
        progress: current.progress ? {
          ...current.progress,
          stage: current.progress.stage ?? 'chapter_list',
          stageDetail: current.progress.stageDetail ?? 'chapter list extracted',
          chapterListSummary,
        } : {
          totalItems: 0,
          completedItems: 0,
          failedItems: 0,
          percentage: 0,
          stage: 'chapter_list',
          stageDetail: 'chapter list extracted',
          chapterListSummary,
        },
      }) : current);
      return;
    }

    if (message.event === 'task:progress') {
      const progressData = message.data?.progress as Record<string, unknown> | undefined;
      if (!progressData) {
        return;
      }

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
      const now = new Date().toISOString();

      setDetail((current) => current ? ({
        ...current,
        task: {
          ...current.task,
          status: current.task.status === 'pending' || current.task.status === 'paused' ? 'running' : current.task.status,
        },
        progress: {
          totalItems,
          completedItems,
          failedItems,
          percentage,
          stage,
          stageDetail,
          currentItems,
          ...(metadata ? { metadata } : {}),
          ...(chapterListSummary ? { chapterListSummary } : {}),
          startedAt: current.progress?.startedAt ?? current.task.startedAt ?? now,
          updatedAt: now,
        },
        result: metadata ? {
          taskId: current.result?.taskId ?? current.task.id,
          status: current.result?.status ?? current.task.status,
          downloadedImages: current.result?.downloadedImages ?? 0,
          failedImages: current.result?.failedImages ?? 0,
          totalImages: current.result?.totalImages ?? 0,
          ...current.result,
          metadata,
          ...(typeof progressData.outputPath === 'string' ? { outputPath: progressData.outputPath } : {}),
        } : current.result,
      }) : current);
      return;
    }

    if (message.event === 'task:started' || message.event === 'task:paused' || message.event === 'task:resumed' || message.event === 'task:cancelled') {
      const statusByEvent: Record<string, TaskDetail['task']['status']> = {
        'task:started': 'running',
        'task:paused': 'paused',
        'task:resumed': 'pending',
        'task:cancelled': 'cancelled',
      };

      setDetail((current) => current ? ({
        ...current,
        task: {
          ...current.task,
          status: statusByEvent[message.event!] ?? current.task.status,
          completedAt: message.event === 'task:cancelled' ? new Date().toISOString() : current.task.completedAt,
        },
      }) : current);
      return;
    }

    if (message.event === 'task:completed' || message.event === 'task:failed' || message.event === 'task:waiting_verification') {
      setDetailLoading(true);
      setDetailError(null);
      void api.getTask(eventTaskId)
        .then((response) => {
          setDetail(response.data);
        })
        .catch((loadError: any) => {
          setDetailError(loadError.message);
        })
        .finally(() => {
          setDetailLoading(false);
        });
    }
  }, [applyRealtimeEvent, selectedTaskId]);

  const wsUrl = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    : '';
  const { connected, subscribe, unsubscribe } = useWebSocket(wsUrl, handleRealtimeMessage);

  useEffect(() => {
    if (!connected) {
      return;
    }

    const events = [
      'task:created',
      'task:started',
      'task:progress',
      'task:metadata_extracted',
      'task:chapter_list_extracted',
      'task:paused',
      'task:resumed',
      'task:waiting_verification',
      'task:completed',
      'task:failed',
      'task:cancelled',
      'image:downloaded',
    ];

    events.forEach((event) => subscribe(event));

    return () => {
      events.forEach((event) => unsubscribe(event));
    };
  }, [connected, subscribe, unsubscribe]);

  return {
    detail,
    setDetail,
    detailLoading,
    detailError,
    setDetailError,
    refreshTaskDetail,
    connected,
  };
}
