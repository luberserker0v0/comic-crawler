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

export const TaskManagerPage: React.FC = () => <TaskManagerView model={useTaskManagerModel()} />;

function useTaskManagerModel() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const store = useTaskStore();
  const local = useTaskManagerLocalState();
  const selectedTaskId = useMemo(() => taskId ?? store.tasks[0]?.id ?? null, [taskId, store.tasks]);
  const selected = useSelectedTask(selectedTaskId);
  const challenge = useChallengeFlow(selected.detail?.result?.challengeDiscoveryId);
  useTaskManagerInitialization(store.fetchTasks, local.setPriorityOrderDraft);
  useDefaultTaskNavigation(taskId, store.tasks, navigate);
  const actions = createTaskActions({ store, local, selected, challenge, selectedTaskId, navigate });
  return { store, local, selected, challenge, selectedTaskId, actions, text: useI18n().text };
}

function useTaskManagerLocalState() {
  const [taskAction, setTaskAction] = useState<string | null>(null);
  const [folderAction, setFolderAction] = useState<string | null>(null);
  const [priorityOrderDraft, setPriorityOrderDraft] = useState('');
  const [priorityOrderMessage, setPriorityOrderMessage] = useState<string | null>(null);
  return { taskAction, setTaskAction, folderAction, setFolderAction, priorityOrderDraft,
    setPriorityOrderDraft, priorityOrderMessage, setPriorityOrderMessage };
}

function useTaskManagerInitialization(fetchTasks: () => Promise<void>, setDraft: (value: string) => void) {
  useEffect(() => {
    void fetchTasks();
    api.getTaskPriorityOrder().then((response) => setDraft((response.data.taskIds ?? []).join('\n')))
      .catch(() => undefined);
  }, [fetchTasks, setDraft]);
}

type TaskList = ReturnType<typeof useTaskStore.getState>['tasks'];

function useDefaultTaskNavigation(taskId: string | undefined, tasks: TaskList, navigate: ReturnType<typeof useNavigate>) {
  useEffect(() => {
    if (!taskId && tasks.length > 0) navigate(`/tasks/${tasks[0]!.id}`, { replace: true });
  }, [taskId, tasks, navigate]);
}

type ActionContext = {
  store: ReturnType<typeof useTaskStore.getState>;
  local: ReturnType<typeof useTaskManagerLocalState>;
  selected: ReturnType<typeof useSelectedTask>;
  challenge: ReturnType<typeof useChallengeFlow>;
  selectedTaskId: string | null;
  navigate: ReturnType<typeof useNavigate>;
};

function createTaskActions(context: ActionContext) {
  return {
    handleResumeTask: (id: string) => resumeTask(context, id),
    openTaskOutputFolder: () => openOutputFolder(context),
    handleDelete: (id: string) => deleteTask(context, id),
    savePriorityOrder: () => savePriorityOrder(context.local),
    fillPriorityOrderFromVisibleTasks: () => fillPriorityOrder(context.local, context.store.tasks),
  };
}

async function resumeTask(context: ActionContext, id: string) {
  try {
    context.local.setTaskAction('resume');
    await context.store.resumeTask(id);
    const updated = await context.selected.refreshTaskDetail(id);
    const challengeId = updated?.result?.challengeDiscoveryId;
    if (challengeId) await context.challenge.refreshChallengeJob(challengeId);
  } finally {
    context.local.setTaskAction(null);
  }
}

async function openOutputFolder(context: ActionContext) {
  const outputPath = context.selected.detail?.result?.outputPath;
  if (!outputPath) return;
  try {
    context.local.setFolderAction('open-output');
    await api.openDownloadDirectory(outputPath);
    context.selected.setDetailError(null);
  } catch (error: any) {
    context.selected.setDetailError(error.response?.data?.error ?? error.message);
  } finally {
    context.local.setFolderAction(null);
  }
}

async function deleteTask(context: ActionContext, id: string) {
  await context.store.deleteTask(id);
  if (context.selectedTaskId !== id) return;
  const remaining = context.store.tasks.filter((task) => task.id !== id);
  context.navigate(remaining[0] ? `/tasks/${remaining[0].id}` : '/tasks', { replace: true });
  context.selected.setDetail(null);
}

async function savePriorityOrder(local: ReturnType<typeof useTaskManagerLocalState>) {
  local.setPriorityOrderMessage(null);
  try {
    const taskIds = local.priorityOrderDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const response = await api.updateTaskPriorityOrder(taskIds);
    local.setPriorityOrderDraft((response.data.taskIds ?? []).join('\n'));
    local.setPriorityOrderMessage('Task priority order saved.');
  } catch (error: any) {
    local.setPriorityOrderMessage(error.response?.data?.error ?? error.message);
  }
}

function fillPriorityOrder(local: ReturnType<typeof useTaskManagerLocalState>, tasks: TaskList) {
  local.setPriorityOrderDraft(tasks.map((task) => task.id).join('\n'));
}

type TaskManagerModel = ReturnType<typeof useTaskManagerModel>;

function TaskManagerView({ model }: { model: TaskManagerModel }) {
  return <div className="mx-auto max-w-7xl space-y-6">
    <TaskManagerHeader model={model} />
    <PriorityOrder model={model} />
    <TaskManagerError model={model} />
    <TaskWorkspace model={model} />
  </div>;
}

function TaskManagerHeader({ model }: { model: TaskManagerModel }) {
  return <div className="rounded-2xl bg-white p-6 shadow"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div><h1 className="text-3xl font-bold text-slate-900">{model.text.taskManager.title}</h1>
      <p className="mt-2 text-sm text-slate-600">{model.text.taskManager.description}</p></div>
    <div className="flex items-center gap-4">
      <button onClick={() => void model.store.fetchTasks()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{model.text.taskManager.refresh}</button>
      <Link to="/" className="text-sm text-slate-600 hover:underline">{model.text.nav.dashboard}</Link>
    </div>
  </div></div>;
}

function PriorityOrder({ model }: { model: TaskManagerModel }) {
  return <PriorityOrderPanel priorityOrderDraft={model.local.priorityOrderDraft}
    setPriorityOrderDraft={model.local.setPriorityOrderDraft} priorityOrderMessage={model.local.priorityOrderMessage}
    fillPriorityOrderFromVisibleTasks={model.actions.fillPriorityOrderFromVisibleTasks}
    savePriorityOrder={model.actions.savePriorityOrder} />;
}

function TaskManagerError({ model }: { model: TaskManagerModel }) {
  const error = model.store.error ?? model.selected.detailError;
  if (!error) return null;
  return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
    <div>{error}</div>{model.store.error && <button onClick={model.store.clearError} className="mt-2 underline">{model.text.settings.dismissError}</button>}
  </div>;
}

function TaskWorkspace({ model }: { model: TaskManagerModel }) {
  return <div className="grid gap-6 lg:grid-cols-[1.1fr_1.9fr]">
    <TaskListSection tasks={model.store.tasks} loading={model.store.loading} selectedTaskId={model.selectedTaskId} />
    <TaskDetailWorkspace model={model} />
  </div>;
}

function TaskDetailWorkspace({ model }: { model: TaskManagerModel }) {
  return <section className="space-y-6">
    {!model.selectedTaskId && <EmptyTask text={model.text.taskManager.emptyState} />}
    {model.selectedTaskId && model.selected.detail && <SelectedTaskContent model={model} />}
    {model.selectedTaskId && model.selected.detailLoading && <EmptyTask text={model.text.stats.loading} />}
  </section>;
}

function EmptyTask({ text }: { text: string }) {
  return <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow">{text}</div>;
}

function SelectedTaskContent({ model }: { model: TaskManagerModel }) {
  const detail = model.selected.detail!;
  return <>
    <TaskDetailSection detail={detail} taskAction={model.local.taskAction}
      isVerificationBrowserOpening={model.challenge.isVerificationBrowserOpening}
      pauseTask={model.store.pauseTask} cancelTask={model.store.cancelTask}
      handleResumeTask={model.actions.handleResumeTask} handleDelete={model.actions.handleDelete}
      openTaskOutputFolder={model.actions.openTaskOutputFolder} folderAction={model.local.folderAction} />
    {detail.result?.challengeDiscoveryId && <TaskVerification model={model} />}
    <PreviewSection detail={detail} />
  </>;
}

function TaskVerification({ model }: { model: TaskManagerModel }) {
  return <VerificationHandoffSection detail={model.selected.detail!} challengeJob={model.challenge.challengeJob}
    challengeAction={model.challenge.challengeAction} challengeError={model.challenge.challengeError}
    shouldReopenVerificationBrowser={model.challenge.shouldReopenVerificationBrowser}
    isChallengeJobUnavailable={model.challenge.isChallengeJobUnavailable}
    openVerificationBrowser={model.challenge.openVerificationBrowser} />;
}
