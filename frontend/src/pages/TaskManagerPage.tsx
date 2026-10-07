import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTaskStore } from '../store';
import { ProgressBar } from '../components/ProgressBar';
import { useI18n } from '../text/i18n';
import {
  MetadataAndChapterPanel,
  TaskFlowChart,
  canResumeTaskDetail,
  formatBytes,
  formatDate,
} from './tasks/widgets';
import { useChallengeFlow } from './tasks/useChallengeFlow';
import { useSelectedTask } from './tasks/useSelectedTask';

export const TaskManagerPage: React.FC = () => {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { text } = useI18n();
  const { tasks, loading, error, fetchTasks, pauseTask, resumeTask, cancelTask, deleteTask, clearError } = useTaskStore();
  const [taskAction, setTaskAction] = useState<string | null>(null);
  const [folderAction, setFolderAction] = useState<string | null>(null);
  const [priorityOrderDraft, setPriorityOrderDraft] = useState('');
  const [priorityOrderMessage, setPriorityOrderMessage] = useState<string | null>(null);

  const selectedTaskId = useMemo(() => taskId ?? tasks[0]?.id ?? null, [taskId, tasks]);
  const {
    detail,
    setDetail,
    detailLoading,
    detailError,
    setDetailError,
    refreshTaskDetail,
  } = useSelectedTask(selectedTaskId);
  const challengeDiscoveryId = detail?.result?.challengeDiscoveryId;
  const {
    challengeJob,
    challengeAction,
    challengeError,
    browserOptions,
    browserExecutablePath,
    setBrowserExecutablePath,
    shouldReopenVerificationBrowser,
    isVerificationBrowserOpening,
    isExternalVerificationUnreadable,
    isChallengeJobUnavailable,
    refreshChallengeJob,
    browseBrowserExecutable,
    openVerificationBrowser,
  } = useChallengeFlow(challengeDiscoveryId);

  useEffect(() => {
    void fetchTasks();
    api.getTaskPriorityOrder()
      .then((response) => {
        setPriorityOrderDraft((response.data.taskIds ?? []).join('\n'));
      })
      .catch(() => undefined);
  }, [fetchTasks]);

  useEffect(() => {
    if (!taskId && tasks.length > 0) {
      navigate(`/tasks/${tasks[0]!.id}`, { replace: true });
    }
  }, [taskId, tasks, navigate]);

  const handleResumeTask = async (id: string) => {
    try {
      setTaskAction('resume');
      await resumeTask(id);
      const updated = await refreshTaskDetail(id);
      const updatedChallengeId = updated?.result?.challengeDiscoveryId;
      if (updatedChallengeId) {
        await refreshChallengeJob(updatedChallengeId);
      }
    } finally {
      setTaskAction(null);
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
                    {canResumeTaskDetail(detail) && (
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

                <TaskFlowChart detail={detail} />

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
                      <div>{text.taskManager.currentItem}: {detail.progress.stageDetail ?? detail.progress.currentItems ?? '-'}</div>
                    </div>
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

                <MetadataAndChapterPanel detail={detail} />

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
