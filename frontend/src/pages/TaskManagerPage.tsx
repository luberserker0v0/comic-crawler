import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTaskStore, type TaskDetail } from '../store';
import { ProgressBar } from '../components/ProgressBar';
import { useWebSocket } from '../hooks';
import { useI18n } from '../text/i18n';

function formatDate(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface LocalBrowserProfile {
  id: string;
  name: string;
  directory?: string;
}

interface LocalBrowserOption {
  id: string;
  name: string;
  executablePath: string;
  profiles: LocalBrowserProfile[];
  defaultProfileId?: string;
}

export const TaskManagerPage: React.FC = () => {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { text } = useI18n();
  const { tasks, loading, error, fetchTasks, applyRealtimeEvent, pauseTask, resumeTask, cancelTask, deleteTask, clearError } = useTaskStore();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [challengeJob, setChallengeJob] = useState<any | null>(null);
  const [challengeAction, setChallengeAction] = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [taskAction, setTaskAction] = useState<string | null>(null);
  const [folderAction, setFolderAction] = useState<string | null>(null);
  const [priorityOrderDraft, setPriorityOrderDraft] = useState('');
  const [priorityOrderMessage, setPriorityOrderMessage] = useState<string | null>(null);
  const [browserOptions, setBrowserOptions] = useState<LocalBrowserOption[]>([]);
  const [browserExecutablePath, setBrowserExecutablePath] = useState('');
  const wsUrl = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    : '';

  useEffect(() => {
    void fetchTasks();
    api.getTaskPriorityOrder()
      .then((response) => {
        setPriorityOrderDraft((response.data.taskIds ?? []).join('\n'));
      })
      .catch(() => undefined);
  }, [fetchTasks]);

  const selectedTaskId = useMemo(() => taskId ?? tasks[0]?.id ?? null, [taskId, tasks]);

  useEffect(() => {
    if (!taskId && tasks.length > 0) {
      navigate(`/tasks/${tasks[0]!.id}`, { replace: true });
    }
  }, [taskId, tasks, navigate]);

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

  const challengeDiscoveryId = detail?.result?.challengeDiscoveryId;

  useEffect(() => {
    if (!challengeDiscoveryId) {
      setChallengeJob(null);
      setChallengeError(null);
      return;
    }

    let cancelled = false;
    api.getChallengeDiscovery(challengeDiscoveryId)
      .then((response) => {
        if (!cancelled) {
          setChallengeJob(response.data);
          setChallengeError(null);
        }
      })
      .catch((loadError: any) => {
        if (!cancelled) {
          setChallengeJob(null);
          setChallengeError(loadError.response?.data?.error ?? loadError.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [challengeDiscoveryId]);

  useEffect(() => {
    if (!challengeDiscoveryId) {
      setBrowserOptions([]);
      setBrowserExecutablePath('');
      return;
    }

    let cancelled = false;
    api.getChallengeBrowserOptions()
      .then((response) => {
        if (cancelled) return;
        const browsers = (response.data?.browsers ?? []) as LocalBrowserOption[];
        setBrowserOptions(browsers);
        const first = browsers[0];
        if (first) {
          setBrowserExecutablePath((current) => current || first.executablePath);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrowserOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [challengeDiscoveryId]);

  const shouldReopenVerificationBrowser = Boolean(challengeJob?.status === 'challenge_required' && challengeJob?.browserExecutablePath);
  const isVerificationBrowserOpening =
    challengeAction === 'open-verification-browser' || challengeJob?.status === 'external_browser_opening';
  const isExternalVerificationUnreadable =
    challengeJob?.status === 'external_browser_open' && challengeJob?.browserExecutablePath && !challengeJob?.browserCdpUrl;
  const isChallengeJobUnavailable = Boolean(
    challengeError && /challenge discovery job .*not found|challenge discovery job not found|expired|removed/i.test(challengeError)
  );

  const refreshTaskDetail = async (id: string) => {
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
  };

  const handleResumeTask = async (id: string) => {
    try {
      setTaskAction('resume');
      await resumeTask(id);
      const updated = await refreshTaskDetail(id);
      const updatedChallengeId = updated?.result?.challengeDiscoveryId;
      if (updatedChallengeId) {
        try {
          const response = await api.getChallengeDiscovery(updatedChallengeId);
          setChallengeJob(response.data);
          setChallengeError(null);
        } catch (loadError: any) {
          setChallengeJob(null);
          setChallengeError(loadError.response?.data?.error ?? loadError.message);
        }
      }
    } finally {
      setTaskAction(null);
    }
  };

  const browseBrowserExecutable = async () => {
    try {
      setChallengeAction('browse-browser');
      const response = await api.browseChallengeBrowserExecutable();
      if (response.data?.executablePath) {
        setBrowserExecutablePath(response.data.executablePath);
      }
      setChallengeError(null);
    } catch (actionError: any) {
      setChallengeError(actionError.response?.data?.error ?? actionError.message);
    } finally {
      setChallengeAction(null);
    }
  };

  const openVerificationBrowser = async () => {
    if (!challengeDiscoveryId) return;
    try {
      setChallengeAction('open-verification-browser');
      const response = await api.openChallengeDiscoveryExternalBrowser(challengeDiscoveryId, {
        executablePath: browserExecutablePath || undefined,
      });
      if (response.data?.status) {
        setChallengeJob(response.data);
      }
      setChallengeError(response.data?.error ?? null);
    } catch (actionError: any) {
      setChallengeError(actionError.response?.data?.error ?? actionError.message);
    } finally {
      setChallengeAction(null);
    }
  };

  const openTaskOutputFolder = async () => {
    if (!detail?.result?.outputPath) return;
    try {
      setFolderAction('open-output');
      await api.openDownloadDirectory(detail.result.outputPath);
      setDetailError(null);
    } catch (actionError: any) {
      setDetailError(actionError.response?.data?.error ?? actionError.message);
    } finally {
      setFolderAction(null);
    }
  };

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
      void api.getTask(eventTaskId)
        .then((response) => {
          setDetail(response.data);
        })
        .catch(() => undefined);
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
          currentItems,
          startedAt: current.progress?.startedAt ?? current.task.startedAt ?? now,
          updatedAt: now,
        },
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

  const { connected, subscribe, unsubscribe } = useWebSocket(wsUrl, handleRealtimeMessage);

  useEffect(() => {
    if (!connected) {
      return;
    }

    const events = [
      'task:created',
      'task:started',
      'task:progress',
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

  const handleDelete = async (id: string) => {
    await deleteTask(id);
    if (selectedTaskId === id) {
      const remaining = tasks.filter((task) => task.id !== id);
      navigate(remaining[0] ? `/tasks/${remaining[0].id}` : '/tasks', { replace: true });
      setDetail(null);
    }
  };

  const savePriorityOrder = async () => {
    setPriorityOrderMessage(null);
    try {
      const taskIds = priorityOrderDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const response = await api.updateTaskPriorityOrder(taskIds);
      setPriorityOrderDraft((response.data.taskIds ?? []).join('\n'));
      setPriorityOrderMessage('Task priority order saved.');
    } catch (saveError: any) {
      setPriorityOrderMessage(saveError.response?.data?.error ?? saveError.message);
    }
  };

  const fillPriorityOrderFromVisibleTasks = () => {
    setPriorityOrderDraft(tasks.map((task) => task.id).join('\n'));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{text.taskManager.title}</h1>
            <p className="mt-2 text-sm text-slate-600">{text.taskManager.description}</p>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => void fetchTasks()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
              {text.taskManager.refresh}
            </button>
            <Link to="/" className="text-sm text-slate-600 hover:underline">
              {text.nav.dashboard}
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Forced task order</h2>
            <p className="mt-1 text-sm text-slate-600">
              One task id per line. Pending tasks listed here run in this exact order before tasks outside the list.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={fillPriorityOrderFromVisibleTasks}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Fill visible
            </button>
            <button
              type="button"
              onClick={() => void savePriorityOrder()}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              Save order
            </button>
          </div>
        </div>
        <textarea
          value={priorityOrderDraft}
          onChange={(event) => setPriorityOrderDraft(event.target.value)}
          className="mt-4 h-28 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs shadow-sm focus:border-slate-500 focus:ring-slate-500"
          placeholder="task-..."
        />
        {priorityOrderMessage && (
          <div className="mt-2 text-sm text-slate-600">{priorityOrderMessage}</div>
        )}
      </div>

      {(error || detailError) && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <div>{error ?? detailError}</div>
          {error && (
            <button onClick={clearError} className="mt-2 underline">
              {text.settings.dismissError}
            </button>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.9fr]">
        <section className="overflow-hidden rounded-2xl bg-white shadow">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">{text.taskManager.listTitle}</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {tasks.map((task) => {
              const isSelected = selectedTaskId === task.id;
              return (
                <Link
                  key={task.id}
                  to={`/tasks/${task.id}`}
                  className={`block px-6 py-4 transition hover:bg-slate-50 ${isSelected ? 'bg-slate-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{task.id}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{task.url}</div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                      {text.taskList.statusLabels[task.status as keyof typeof text.taskList.statusLabels] ?? task.status}
                    </span>
                  </div>
                  {task.progress && task.progress.totalItems > 0 && (
                    <div className="mt-3">
                      <ProgressBar current={task.progress.completedItems} total={task.progress.totalItems} />
                    </div>
                  )}
                </Link>
              );
            })}
            {!loading && tasks.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-slate-500">{text.taskList.empty}</div>
            )}
          </div>
        </section>

        <section className="space-y-6">
          {!selectedTaskId && (
            <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow">
              {text.taskManager.emptyState}
            </div>
          )}

          {selectedTaskId && detail && (
            <>
              <div className="rounded-2xl bg-white p-6 shadow">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold text-slate-900">{text.taskManager.detailTitle}</h2>
                    <div className="mt-2 text-sm text-slate-600">{detail.task.id}</div>
                    <div className="mt-1 break-all text-sm text-slate-500">{detail.task.url}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detail.task.status === 'running' && (
                      <button onClick={() => void pauseTask(detail.task.id)} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white">
                        {text.taskList.pause}
                      </button>
                    )}
                    {(detail.task.status === 'paused' || detail.task.status === 'interrupted' || detail.task.status === 'waiting_verification') && (
                      <button
                        onClick={() => void handleResumeTask(detail.task.id)}
                        disabled={taskAction !== null || isVerificationBrowserOpening || isExternalVerificationUnreadable}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {isVerificationBrowserOpening
                          ? 'Opening browser...'
                          : isExternalVerificationUnreadable
                            ? 'Browser not readable'
                            : taskAction === 'resume'
                              ? 'Continuing...'
                              : text.taskList.resume}
                      </button>
                    )}
                    {['running', 'pending', 'paused'].includes(detail.task.status) && (
                      <button onClick={() => void cancelTask(detail.task.id)} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white">
                        {text.taskList.cancel}
                      </button>
                    )}
                    {['completed', 'failed', 'cancelled', 'interrupted', 'waiting_verification'].includes(detail.task.status) && (
                      <button onClick={() => void handleDelete(detail.task.id)} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white">
                        {text.taskList.delete}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.taskList.status}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {text.taskList.statusLabels[detail.task.status as keyof typeof text.taskList.statusLabels] ?? detail.task.status}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.taskManager.createdAt}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{formatDate(detail.task.createdAt)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.taskManager.startedAt}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{formatDate(detail.task.startedAt)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.taskManager.completedAt}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{formatDate(detail.task.completedAt)}</div>
                  </div>
                </div>

                {detail.progress && detail.progress.totalItems > 0 && (
                  <div className="mt-6 rounded-xl border border-slate-200 p-4">
                    <ProgressBar
                      current={detail.progress.completedItems}
                      total={detail.progress.totalItems}
                      label={text.taskList.progress}
                    />
                    <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                      <div>{text.taskManager.downloadedImages}: {detail.progress.completedItems}</div>
                      <div>{text.taskManager.failedImages}: {detail.progress.failedItems}</div>
                      <div>{text.taskManager.currentItem}: {detail.progress.currentItems ?? '-'}</div>
                    </div>
                  </div>
                )}
                {detail.progress?.currentItems && (!detail.progress.totalItems || detail.progress.totalItems === 0) && (
                  <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Current stage</div>
                    <div className="mt-2 font-medium text-slate-900">{detail.progress.currentItems}</div>
                  </div>
                )}

                {detail.checkpoint && (
                  <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <div className="text-xs uppercase tracking-[0.25em] text-emerald-500">Resume checkpoint</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <div>
                        <div className="text-xs text-emerald-700">Current chapter</div>
                        <div className="mt-1 font-medium">{detail.checkpoint.currentChapter ?? '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-emerald-700">Completed images</div>
                        <div className="mt-1 font-medium">{detail.checkpoint.completedImages}</div>
                      </div>
                      <div>
                        <div className="text-xs text-emerald-700">Failed images</div>
                        <div className="mt-1 font-medium">{detail.checkpoint.failedImages}</div>
                      </div>
                      <div>
                        <div className="text-xs text-emerald-700">Updated</div>
                        <div className="mt-1 font-medium">{formatDate(detail.checkpoint.updatedAt)}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-emerald-700">
                      {detail.checkpoint.resumable ? 'This task can continue from the last saved image checkpoint.' : 'Checkpoint is complete; resume is not needed.'}
                    </div>
                  </div>
                )}

                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.taskManager.metadataTitle}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {typeof detail.result?.metadata?.title === 'string' ? detail.result.metadata.title : '-'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.taskManager.totalImages}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{detail.result?.totalImages ?? 0}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.taskManager.downloadedImages}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{detail.result?.downloadedImages ?? 0}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.taskManager.failedImages}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{detail.result?.failedImages ?? 0}</div>
                  </div>
                </div>

                <dl className="mt-6 space-y-4 text-sm">
                  <div>
                    <dt className="text-slate-400">{text.taskManager.outputPath}</dt>
                    <dd className="mt-1 flex flex-col gap-2 break-all font-medium text-slate-900 sm:flex-row sm:items-center">
                      <span>{detail.result?.outputPath ?? '-'}</span>
                      {detail.result?.outputPath && (
                        <button
                          type="button"
                          onClick={() => void openTaskOutputFolder()}
                          disabled={folderAction !== null}
                          className="w-fit rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {folderAction === 'open-output' ? 'Opening...' : 'Open folder'}
                        </button>
                      )}
                    </dd>
                  </div>
                  {detail.task.error && (
                    <div>
                      <dt className="text-slate-400">{text.taskManager.error}</dt>
                      <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-rose-700">{detail.task.error}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {detail.result?.challengeDiscoveryId && (
                <div
                  className="rounded-2xl border border-purple-200 bg-purple-50 p-6 text-purple-950 shadow"
                  data-testid="task-verification-handoff"
                >
                  <div>
                    <h3 className="text-lg font-semibold">Human verification required</h3>
                    <p className="mt-2 text-sm text-purple-800">
                      The adapter matched this URL, but crawling reached a human verification page. Open an isolated browser from here, complete verification as a human, then use Continue to resume this task from its checkpoint.
                    </p>
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                      <div className="break-all">Challenge job: {detail.result.challengeDiscoveryId}</div>
                      <div>Status: {challengeJob?.status ?? detail.result.challengeStatus ?? '-'}</div>
                      <div className="break-all md:col-span-2">URL: {challengeJob?.normalizedUrl ?? detail.task.url}</div>
                    </div>
                  </div>

                  {isChallengeJobUnavailable ? (
                    <div
                      className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                      data-testid="challenge-job-unavailable-message"
                    >
                      This verification handoff expired or was removed. Click Continue to recreate the handoff, then open the browser from this task detail page.
                    </div>
                  ) : challengeError ? (
                    <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                      {challengeError}
                    </div>
                  ) : null}

                  {!isChallengeJobUnavailable && (
                  <div className="mt-4 rounded-xl border border-purple-200 bg-white p-4">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                      <label className="block">
                        <span className="text-sm font-medium text-purple-950">Local browser executable</span>
                        <input
                          type="text"
                          value={browserExecutablePath}
                          onChange={(event) => setBrowserExecutablePath(event.target.value)}
                          placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                          className="mt-1 block w-full rounded-md border-purple-200 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                          data-testid="verification-browser-path-input"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void browseBrowserExecutable()}
                        disabled={challengeAction !== null}
                        className="self-end rounded-md border border-purple-300 bg-white px-3 py-2 text-sm font-medium text-purple-900 shadow-sm hover:bg-purple-100 disabled:opacity-50"
                      >
                        {challengeAction === 'browse-browser' ? 'Browsing...' : 'Browse'}
                      </button>
                    </div>

                    <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                      ComicCrawler will open an isolated verification profile for this task. Your normal Chrome/Brave profiles are not used.
                    </div>

                    {browserOptions.length === 0 && (
                      <p className="mt-2 text-xs text-purple-800">
                        No local browser was auto-detected. Enter the browser executable path manually, or use Browse on Windows.
                      </p>
                    )}
                    {browserExecutablePath && (
                      <p className="mt-2 text-xs text-purple-800">
                        Recommended: ComicCrawler will open a separate browser profile so your normal Brave/Chrome session can keep running the WebUI.
                      </p>
                    )}
                    {shouldReopenVerificationBrowser && (
                      <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        ComicCrawler cannot read the previous browser session. Close all windows for this browser/profile, then reopen it from here.
                      </p>
                    )}
                    {isExternalVerificationUnreadable && (
                      <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        This browser window opened, but ComicCrawler cannot read it because no Chromium debugging connection was exposed. Use the isolated profile, or close every Chrome window that uses the selected profile and open it again from here.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => void openVerificationBrowser()}
                      disabled={challengeAction !== null}
                      className="mt-4 rounded-md bg-purple-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-800 disabled:opacity-50"
                      data-testid="open-verification-browser-button"
                    >
                      {challengeAction === 'open-verification-browser'
                        ? 'Opening browser...'
                        : shouldReopenVerificationBrowser
                          ? 'Reopen browser for verification'
                          : 'Open browser for verification'}
                    </button>
                  </div>
                  )}
                </div>
              )}

              <div className="rounded-2xl bg-white p-6 shadow">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">{text.taskManager.previewTitle}</h3>
                  {detail.preview && (
                    <div className="text-sm text-slate-500">
                      {text.taskManager.files}: {detail.preview.totalFiles}
                    </div>
                  )}
                </div>
                {detail.preview ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.25em] text-slate-400">
                      {detail.preview.rootDir}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {detail.preview.files.map((file) => (
                        <div key={file.relativePath} className="grid gap-3 px-4 py-3 md:grid-cols-[72px_1.6fr_0.5fr_0.7fr]">
                          <div className="h-16 w-16 overflow-hidden rounded border border-slate-200 bg-slate-50">
                            {file.isImage && file.url ? (
                              <img src={file.url} alt={file.name} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">File</div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">{file.relativePath}</div>
                            <div className="mt-1 text-xs text-slate-500">{file.name}</div>
                          </div>
                          <div className="text-sm text-slate-600">{formatBytes(file.size)}</div>
                          <div className="text-sm text-slate-600">{formatDate(file.modifiedAt)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    {text.taskManager.noPreview}
                  </div>
                )}
              </div>
            </>
          )}

          {selectedTaskId && detailLoading && (
            <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow">
              {text.stats.loading}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
