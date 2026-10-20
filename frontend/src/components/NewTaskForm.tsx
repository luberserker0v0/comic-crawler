import React from 'react';
import { Link } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';
import { useTaskStore } from '../store';
import { useLocalStorage } from '../hooks';
import { useI18n } from '../text/i18n';
import { AdapterPreviewPanel, CHAPTER_URL_PLACEHOLDER, MANGA_URL_PLACEHOLDER,
  getChallengeStatusMessage, type AdapterBuildTaskResult, type ChallengeBuildTaskResult,
  type TaskMode } from './task-form/widgets';
import { useAdapterPreview } from './task-form/useAdapterPreview';

type BrowserWorker = { workerId: string; name: string; status: string; capabilities?: { executionMode?: string } };

export const NewTaskForm: React.FC = () => <TaskFormView model={useTaskFormModel()} />;

function useTaskFormModel() {
  const state = useTaskFormState();
  const taskStore = useTaskStore();
  const text = useI18n().text;
  useBrowserWorkers(state.setBrowserWorkers);
  const normalizedChapterUrls = state.chapterUrls.map((url) => url.trim()).filter(Boolean);
  const preview = useAdapterPreview(state.mode, state.mangaUrl, normalizedChapterUrls[0] ?? '');
  const canSubmit = state.mode === 'all' ? Boolean(state.mangaUrl.trim())
    : state.mode === 'chapters' && normalizedChapterUrls.length > 0;
  const context = { state, taskStore, preview, normalizedChapterUrls };
  return { state, taskStore, text, preview, canSubmit,
    selectMode: (mode: TaskMode) => selectMode(context, mode),
    handleSubmit: (event: React.FormEvent) => submitTask(context, event),
    refreshAdapterBuildTask: () => refreshAdapterBuildTask(state) };
}

function useTaskFormState() {
  const [mode, setMode] = React.useState<TaskMode | null>(null);
  const [mangaUrl, setMangaUrl] = useLocalStorage('task-form:manga-url', '');
  const [chapterUrls, setChapterUrls] = useLocalStorage<string[]>('task-form:chapter-urls', ['']);
  const [priority, setPriority] = useLocalStorage('task-form:priority', 0);
  const [showAdvanced, setShowAdvanced] = useLocalStorage('task-form:advanced', false);
  const [browserWorkerId, setBrowserWorkerId] = useLocalStorage('task-form:browser-worker', 'any');
  const [browserWorkers, setBrowserWorkers] = React.useState<BrowserWorker[]>([]);
  const [createdTaskId, setCreatedTaskId] = React.useState<string | null>(null);
  const [adapterBuildTask, setAdapterBuildTask] = React.useState<AdapterBuildTaskResult | null>(null);
  const [challengeBuildTask, setChallengeBuildTask] = React.useState<ChallengeBuildTaskResult | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  return { mode, setMode, mangaUrl, setMangaUrl, chapterUrls, setChapterUrls, priority, setPriority,
    showAdvanced, setShowAdvanced, browserWorkerId, setBrowserWorkerId, browserWorkers, setBrowserWorkers,
    createdTaskId, setCreatedTaskId, adapterBuildTask, setAdapterBuildTask, challengeBuildTask,
    setChallengeBuildTask, submitError, setSubmitError };
}

function useBrowserWorkers(setWorkers: (workers: BrowserWorker[]) => void) {
  React.useEffect(() => {
    void api.getBrowserWorkers().then((response) => setWorkers(response.data.workers.filter(
      (worker) => worker.capabilities?.executionMode === 'managed-profile'))).catch(() => setWorkers([]));
  }, [setWorkers]);
}

type TaskFormState = ReturnType<typeof useTaskFormState>;
type TaskFormContext = { state: TaskFormState; taskStore: ReturnType<typeof useTaskStore.getState>;
  preview: ReturnType<typeof useAdapterPreview>; normalizedChapterUrls: string[] };

function selectMode(context: TaskFormContext, nextMode: TaskMode) {
  const { state } = context;
  state.setMode(nextMode);
  const blankChapters = state.chapterUrls.length === 0 || state.chapterUrls.every((url) => !url.trim())
    || state.chapterUrls.every((url) => url === CHAPTER_URL_PLACEHOLDER);
  if (nextMode === 'chapters' && blankChapters) state.setChapterUrls(['']);
  state.setCreatedTaskId(null); state.setAdapterBuildTask(null); state.setChallengeBuildTask(null);
  context.preview.resetAdapterPreview(); state.setSubmitError(null);
}

async function submitTask(context: TaskFormContext, event: React.FormEvent) {
  event.preventDefault();
  const { state, normalizedChapterUrls } = context;
  const canSubmit = state.mode === 'all' ? Boolean(state.mangaUrl.trim()) : normalizedChapterUrls.length > 0;
  if (!state.mode || !canSubmit) return;
  clearSubmitResult(state);
  const taskUrl = state.mode === 'all' ? state.mangaUrl.trim() : normalizedChapterUrls[0]!;
  try {
    const result = await context.taskStore.createTask(taskUrl, createTaskOptions(state, normalizedChapterUrls));
    applySubmitResult(state, result);
  } catch (error) {
    state.setSubmitError(getApiErrorMessage(error));
  }
}

function createTaskOptions(state: TaskFormState, chapterUrls: string[]) {
  const browserTarget = state.browserWorkerId === 'any' ? { mode: 'managed-profile' as const }
    : { mode: 'managed-profile' as const, workerId: state.browserWorkerId };
  return { mode: state.mode!, chapterUrls: state.mode === 'chapters' ? chapterUrls : undefined,
    priority: state.priority, browserTarget };
}

function applySubmitResult(state: TaskFormState, result: Awaited<ReturnType<ReturnType<typeof useTaskStore.getState>['createTask']>>) {
  if (result.kind === 'discoveryQueued') { state.setAdapterBuildTask(result); return; }
  if (result.kind === 'challengeDiscoveryQueued') { state.setChallengeBuildTask(result); return; }
  state.setCreatedTaskId(result.taskId);
  if (state.mode === 'chapters') state.setChapterUrls(['']);
  state.setPriority(0);
}

function clearSubmitResult(state: TaskFormState) {
  state.setCreatedTaskId(null); state.setAdapterBuildTask(null);
  state.setChallengeBuildTask(null); state.setSubmitError(null);
}

async function refreshAdapterBuildTask(state: TaskFormState) {
  const task = state.adapterBuildTask;
  if (!task) return;
  try {
    const response = await api.getSelectorDiscovery(task.discoveryId);
    state.setAdapterBuildTask({ ...task, status: response.data.status,
      normalizedUrl: response.data.normalizedUrl ?? task.normalizedUrl, target: response.data.target ?? task.target,
      adapterId: response.data.adapterId ?? task.adapterId, adapterName: response.data.adapterName ?? task.adapterName,
      error: response.data.error });
  } catch (error) {
    state.setAdapterBuildTask({ ...task, error: getApiErrorMessage(error) });
  }
}

type TaskFormModel = ReturnType<typeof useTaskFormModel>;
type TaskFormText = ReturnType<typeof useI18n>['text'];

function TaskFormView({ model }: { model: TaskFormModel }) {
  return <form onSubmit={model.handleSubmit} className="space-y-5">
    <TaskFormMessages model={model} />
    <ModeSelector model={model} />
    <TaskUrlFields model={model} />
    {model.state.mode && <AdapterPreviewPanel preview={model.preview.adapterPreview}
      loading={model.preview.adapterPreviewLoading} error={model.preview.adapterPreviewError} />}
    {model.state.mode && <AdvancedOptions model={model} />}
    {model.state.mode && <button type="submit" data-testid="create-task-submit"
      disabled={model.taskStore.loading || !model.canSubmit}
      className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
      {model.taskStore.loading ? model.text.taskForm.submitting : model.text.taskForm.submit}</button>}
  </form>;
}

function TaskFormMessages({ model }: { model: TaskFormModel }) {
  const error = model.state.submitError ?? model.taskStore.error;
  return <>{error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}
    {model.state.createdTaskId && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
      {model.text.taskForm.created}{' '}<Link to={`/tasks/${model.state.createdTaskId}`} className="font-medium underline">{model.text.taskForm.viewTask}</Link></div>}
    {model.state.adapterBuildTask && <AdapterBuildStatus model={model} />}
    {model.state.challengeBuildTask && <ChallengeBuildStatus task={model.state.challengeBuildTask} text={model.text} />}
  </>;
}

function AdapterBuildStatus({ model }: { model: TaskFormModel }) {
  const task = model.state.adapterBuildTask!;
  return <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status" data-testid="adapter-build-task-status">
    <div className="font-medium">{model.text.taskForm.adapterBuildCreated}</div><div className="mt-1 break-all">{task.normalizedUrl}</div>
    <AdapterBuildFacts task={task} />
    <AdapterBuildReason task={task} />
    <div className="mt-2 rounded border border-amber-300 bg-white p-2">
      <div>{task.target === 'chapter-only' ? model.text.taskForm.chapterOnlyDiscoveryQueued : model.text.taskForm.fullDiscoveryQueued}</div>
      <div className="mt-1 text-amber-800">{model.text.taskForm.discoveryNotCrawlerTask}</div>
      <Link to="/agent" className="mt-2 inline-block font-medium underline">{model.text.taskForm.openDiscovery}</Link></div>
    {task.status === 'configuration_required' && <div className="mt-2 rounded border border-amber-300 bg-white p-2">Selector discovery needs AO URL, provider JSON, and model. <Link to="/settings" className="font-medium underline">Open Settings</Link></div>}
    {task.error && <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-700">{task.error}</div>}
    <button type="button" onClick={() => void model.refreshAdapterBuildTask()}
      className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-1 text-sm font-medium text-amber-900">Refresh adapter build status</button>
  </div>;
}

function AdapterBuildFacts({ task }: { task: AdapterBuildTaskResult }) {
  return <div className="mt-2 grid gap-2 md:grid-cols-2">
    <div>Target: {task.target === 'chapter-only' ? 'Chapter-only adapter' : 'Full adapter'}</div><div>Status: {task.status}</div>
    <div>Required capabilities: Metadata {task.requiredCapabilities?.metadata ? 'O' : 'X'} / Images {task.requiredCapabilities?.chapterImages ? 'O' : 'X'}</div>
    <div className="break-all">Job ID: {task.discoveryId}</div>
  </div>;
}

function AdapterBuildReason({ task }: { task: AdapterBuildTaskResult }) {
  if (task.reason === 'adapter_capability_mismatch') return <div className="mt-2">Matched adapter is missing the required capability: {task.adapterName ?? task.adapterId}
    {' - Metadata '}{task.capabilities?.metadata ? 'O' : 'X'}{' / Images '}{task.capabilities?.chapterImages ? 'O' : 'X'}</div>;
  if (task.reason === 'adapter_not_found') return <div className="mt-2">No adapter matches this URL. ComicCrawler created an adapter build task instead of a crawl task.</div>;
  return null;
}

function ChallengeBuildStatus({ task, text }: { task: ChallengeBuildTaskResult; text: TaskFormText }) {
  return <div className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-950" role="status" data-testid="challenge-build-task-status">
    <div className="font-medium">{text.taskForm.verificationJobCreated}</div><div className="mt-1 break-all">{task.normalizedUrl}</div>
    <div className="mt-2 grid gap-2 md:grid-cols-2"><div>{text.taskForm.status}: {task.status}</div>
      <div className="break-all">{text.taskForm.jobId}: {task.challengeDiscoveryId}</div>
      <div className="break-all">{text.taskForm.handoff}: {task.challengeDiscoveryId}</div>
      <div>{text.taskForm.validation}: {task.validation?.valid ? text.taskForm.passed : '-'}</div></div>
    <div className="mt-2 rounded border border-purple-200 bg-white p-2">{getChallengeStatusMessage(task.status, text.taskForm)}</div>
    <div className="mt-2 rounded border border-purple-200 bg-white p-2 text-purple-800">{text.taskForm.verificationTaskBoundary}</div>
    {task.error && <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-700">{task.error}</div>}
  </div>;
}

function ModeSelector({ model }: { model: TaskFormModel }) {
  return <div className="grid gap-3 md:grid-cols-2">
    <ModeButton mode="all" current={model.state.mode} onSelect={model.selectMode}
      title={model.text.taskForm.allChaptersMode} description={model.text.taskForm.allChaptersDescription} />
    <ModeButton mode="chapters" current={model.state.mode} onSelect={model.selectMode}
      title={model.text.taskForm.specificChaptersMode} description={model.text.taskForm.specificChaptersDescription} />
  </div>;
}

function ModeButton(props: { mode: TaskMode; current: TaskMode | null; onSelect(mode: TaskMode): void; title: string; description: string }) {
  const color = props.current === props.mode ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:bg-slate-50';
  return <button type="button" data-testid={`task-mode-${props.mode}`} onClick={() => props.onSelect(props.mode)}
    className={`rounded-lg border p-4 text-left shadow-sm transition ${color}`}>
    <div className="font-semibold text-slate-900">{props.title}</div><p className="mt-2 text-sm text-slate-600">{props.description}</p></button>;
}

function TaskUrlFields({ model }: { model: TaskFormModel }) {
  if (model.state.mode === 'all') return <div><label htmlFor="manga-url" className="block text-sm font-medium text-gray-700">{model.text.taskForm.mangaUrlLabel}</label>
    <input type="url" id="manga-url" value={model.state.mangaUrl} onChange={(event) => model.state.setMangaUrl(event.target.value)}
      placeholder={MANGA_URL_PLACEHOLDER} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" required />
    <p className="mt-1 text-xs text-slate-500">{model.text.taskForm.mangaUrlHelp}</p></div>;
  if (model.state.mode === 'chapters') return <ChapterUrls model={model} />;
  return null;
}

function ChapterUrls({ model }: { model: TaskFormModel }) {
  const update = (index: number, value: string) => model.state.setChapterUrls(
    model.state.chapterUrls.map((url, current) => current === index ? value : url));
  const remove = (index: number) => { const next = model.state.chapterUrls.filter((_, current) => current !== index);
    model.state.setChapterUrls(next.length ? next : ['']); };
  return <div className="space-y-3"><div className="flex items-center justify-between gap-3"><div>
    <div className="text-sm font-medium text-gray-700">{model.text.taskForm.chapterUrlsLabel}</div>
    <p className="mt-1 text-xs text-slate-500">{model.text.taskForm.chapterUrlsHelp}</p></div>
    <button type="button" onClick={() => model.state.setChapterUrls([...model.state.chapterUrls, ''])}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white">+</button></div>
    {model.state.chapterUrls.map((url, index) => <div key={index} className="flex gap-2">
      <input type="url" data-testid={`chapter-url-input-${index}`} value={url} onChange={(event) => update(index, event.target.value)}
        placeholder={CHAPTER_URL_PLACEHOLDER} className="block w-full rounded-md border-gray-300" required={index === 0} />
      <button type="button" onClick={() => remove(index)} className="rounded-md border px-3">x</button></div>)}
  </div>;
}

function AdvancedOptions({ model }: { model: TaskFormModel }) {
  return <div><button type="button" onClick={() => model.state.setShowAdvanced(!model.state.showAdvanced)}
    className="text-sm text-slate-600 underline">{model.state.showAdvanced ? model.text.taskForm.hideAdvanced : model.text.taskForm.showAdvanced}</button>
    {model.state.showAdvanced && <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <label htmlFor="browser-worker" className="block text-sm font-medium">{model.text.taskForm.browserWorkerLabel}</label>
      <select id="browser-worker" value={model.state.browserWorkerId} onChange={(event) => model.state.setBrowserWorkerId(event.target.value)}
        className="mt-1 mb-4 block w-full rounded-md border-gray-300"><option value="any">{model.text.taskForm.anyBrowserWorker}</option>
        {model.state.browserWorkers.map((worker) => <option key={worker.workerId} value={worker.workerId}>{worker.name} ({worker.status})</option>)}</select>
      <p className="-mt-3 mb-4 text-xs text-slate-500">{model.text.taskForm.browserWorkerHelp}</p>
      <label htmlFor="priority" className="block text-sm font-medium">{model.text.taskForm.priorityLabel}</label>
      <input type="number" id="priority" value={model.state.priority} onChange={(event) => model.state.setPriority(Number(event.target.value))}
        min={0} max={10} className="mt-1 block w-full rounded-md border-gray-300" />
      <p className="mt-1 text-xs text-slate-500">{model.text.taskForm.priorityHelp}</p>
    </div>}
  </div>;
}
