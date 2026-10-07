import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTaskStore } from '../store';
import { useI18n } from '../text/i18n';
import { PriorityOrderPanel } from './tasks/sections/PriorityOrderPanel';
import { TaskListSection } from './tasks/sections/TaskListSection';
import { TaskDetailSection } from './tasks/sections/TaskDetailSection';
import { VerificationHandoffSection } from './tasks/sections/VerificationHandoffSection';
import { PreviewSection } from './tasks/sections/PreviewSection';
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

      <PriorityOrderPanel
        priorityOrderDraft={priorityOrderDraft}
        setPriorityOrderDraft={setPriorityOrderDraft}
        priorityOrderMessage={priorityOrderMessage}
        fillPriorityOrderFromVisibleTasks={fillPriorityOrderFromVisibleTasks}
        savePriorityOrder={savePriorityOrder}
      />

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
        <TaskListSection tasks={tasks} loading={loading} selectedTaskId={selectedTaskId} />

        <section className="space-y-6">
          {!selectedTaskId && (
            <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow">
              {text.taskManager.emptyState}
            </div>
          )}

          {selectedTaskId && detail && (
            <>
              <TaskDetailSection
              detail={detail}
              taskAction={taskAction}
              isVerificationBrowserOpening={isVerificationBrowserOpening}
              isExternalVerificationUnreadable={isExternalVerificationUnreadable}
              pauseTask={pauseTask}
              cancelTask={cancelTask}
              handleResumeTask={handleResumeTask}
              handleDelete={handleDelete}
              openTaskOutputFolder={openTaskOutputFolder}
              folderAction={folderAction}
            />

              {detail.result?.challengeDiscoveryId && (
                <VerificationHandoffSection
                  detail={detail}
                  challengeJob={challengeJob}
                  challengeAction={challengeAction}
                  challengeError={challengeError}
                  browserOptions={browserOptions}
                  browserExecutablePath={browserExecutablePath}
                  setBrowserExecutablePath={setBrowserExecutablePath}
                  shouldReopenVerificationBrowser={shouldReopenVerificationBrowser}
                  isExternalVerificationUnreadable={isExternalVerificationUnreadable}
                  isChallengeJobUnavailable={isChallengeJobUnavailable}
                  browseBrowserExecutable={browseBrowserExecutable}
                  openVerificationBrowser={openVerificationBrowser}
                />
              )}

              <PreviewSection detail={detail} />
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
