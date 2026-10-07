import React from 'react';
import { Link } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';
import { useTaskStore } from '../store';
import { useLocalStorage } from '../hooks';
import { useI18n } from '../text/i18n';
import {
  AdapterPreviewPanel,
  CHAPTER_URL_PLACEHOLDER,
  MANGA_URL_PLACEHOLDER,
  getChallengeStatusMessage,
  type AdapterBuildTaskResult,
  type ChallengeBuildTaskResult,
  type TaskMode,
} from './task-form/widgets';
import { useAdapterPreview } from './task-form/useAdapterPreview';

export const NewTaskForm: React.FC = () => {
  const [mode, setMode] = React.useState<TaskMode | null>(null);
  const [mangaUrl, setMangaUrl] = useLocalStorage('task-form:manga-url', '');
  const [chapterUrls, setChapterUrls] = useLocalStorage<string[]>('task-form:chapter-urls', ['']);
  const [priority, setPriority] = useLocalStorage('task-form:priority', 0);
  const [showAdvanced, setShowAdvanced] = useLocalStorage('task-form:advanced', false);
  const [createdTaskId, setCreatedTaskId] = React.useState<string | null>(null);
  const [adapterBuildTask, setAdapterBuildTask] = React.useState<AdapterBuildTaskResult | null>(null);
  const [challengeBuildTask, setChallengeBuildTask] = React.useState<ChallengeBuildTaskResult | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const { createTask, loading, error } = useTaskStore();
  const { text } = useI18n();

  const normalizedChapterUrls = chapterUrls.map((chapterUrl) => chapterUrl.trim()).filter(Boolean);
  const firstChapterUrl = normalizedChapterUrls[0] ?? '';
  const {
    adapterPreview,
    adapterPreviewError,
    adapterPreviewLoading,
    resetAdapterPreview,
  } = useAdapterPreview(mode, mangaUrl, firstChapterUrl);
  const canSubmit = mode === 'all'
    ? mangaUrl.trim().length > 0
    : mode === 'chapters' && normalizedChapterUrls.length > 0;

  const selectMode = (nextMode: TaskMode) => {
    setMode(nextMode);
    if (
      nextMode === 'chapters' &&
      (chapterUrls.length === 0 ||
        chapterUrls.every((chapterUrl) => !chapterUrl.trim()) ||
        chapterUrls.every((chapterUrl) => chapterUrl === CHAPTER_URL_PLACEHOLDER))
    ) {
      setChapterUrls(['']);
    }
    setCreatedTaskId(null);
    setAdapterBuildTask(null);
    setChallengeBuildTask(null);
    resetAdapterPreview();
    setSubmitError(null);
  };

  const updateChapterUrl = (index: number, value: string) => {
    setChapterUrls(chapterUrls.map((chapterUrl, currentIndex) => (currentIndex === index ? value : chapterUrl)));
  };

  const addChapterUrl = () => {
    setChapterUrls([...chapterUrls, '']);
  };

  const removeChapterUrl = (index: number) => {
    const next = chapterUrls.filter((_, currentIndex) => currentIndex !== index);
    setChapterUrls(next.length > 0 ? next : ['']);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mode || !canSubmit) return;

    setCreatedTaskId(null);
    setAdapterBuildTask(null);
    setChallengeBuildTask(null);
    setSubmitError(null);

    const taskUrl = mode === 'all' ? mangaUrl.trim() : normalizedChapterUrls[0]!;

    try {
      const result = await createTask(taskUrl, {
        mode,
        chapterUrls: mode === 'chapters' ? normalizedChapterUrls : undefined,
        priority,
      });

      if (result.kind === 'discoveryQueued') {
        setAdapterBuildTask(result);
        return;
      }

      if (result.kind === 'challengeDiscoveryQueued') {
        setChallengeBuildTask(result);
        return;
      }

      setCreatedTaskId(result.taskId);
      if (mode === 'chapters') {
        setChapterUrls(['']);
      }
      setPriority(0);
    } catch (err: any) {
      setSubmitError(getApiErrorMessage(err));
    }
  };

  const refreshAdapterBuildTask = async () => {
    if (!adapterBuildTask) return;

    try {
      const response = await api.getSelectorDiscovery(adapterBuildTask.discoveryId);
      setAdapterBuildTask({
        ...adapterBuildTask,
        status: response.data.status,
        normalizedUrl: response.data.normalizedUrl ?? adapterBuildTask.normalizedUrl,
        target: response.data.target ?? adapterBuildTask.target,
        adapterId: response.data.adapterId ?? adapterBuildTask.adapterId,
        adapterName: response.data.adapterName ?? adapterBuildTask.adapterName,
        error: response.data.error,
      });
    } catch (err: any) {
      setAdapterBuildTask({
        ...adapterBuildTask,
        error: getApiErrorMessage(err),
      });
    }
  };

  const requiredMetadata = adapterBuildTask?.requiredCapabilities?.metadata === true;
  const requiredImages = adapterBuildTask?.requiredCapabilities?.chapterImages === true;
  const challengeStatusMessage = challengeBuildTask
    ? getChallengeStatusMessage(challengeBuildTask.status)
    : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {(submitError || error) && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {submitError ?? error}
        </div>
      )}

      {createdTaskId && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          <span>{text.taskForm.created}</span>{' '}
          <Link to={`/tasks/${createdTaskId}`} className="font-medium underline">
            {text.taskForm.viewTask}
          </Link>
        </div>
      )}

      {adapterBuildTask && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          role="status"
          data-testid="adapter-build-task-status"
        >
          <div className="font-medium">Adapter build task created.</div>
          <div className="mt-1 break-all">{adapterBuildTask.normalizedUrl}</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>Target: {adapterBuildTask.target === 'chapter-only' ? 'Chapter-only adapter' : 'Full adapter'}</div>
            <div>Status: {adapterBuildTask.status}</div>
            <div>Required capabilities: Metadata {requiredMetadata ? 'O' : 'X'} / Images {requiredImages ? 'O' : 'X'}</div>
            <div className="break-all">Job ID: {adapterBuildTask.discoveryId}</div>
          </div>

          {adapterBuildTask.reason === 'adapter_capability_mismatch' && (
            <div className="mt-2">
              Matched adapter is missing the capability required by this task: {adapterBuildTask.adapterName ?? adapterBuildTask.adapterId}
              {' - Metadata '}
              {adapterBuildTask.capabilities?.metadata ? 'O' : 'X'}
              {' / Images '}
              {adapterBuildTask.capabilities?.chapterImages ? 'O' : 'X'}
            </div>
          )}

          {adapterBuildTask.reason === 'adapter_not_found' && (
            <div className="mt-2">
              No adapter matches this URL. ComicCrawler created an adapter build task instead of a crawl task.
            </div>
          )}

          <div className="mt-2 rounded border border-amber-300 bg-white p-2">
            <div>{adapterBuildTask.target === 'chapter-only' ? text.taskForm.chapterOnlyDiscoveryQueued : text.taskForm.fullDiscoveryQueued}</div>
            <div className="mt-1 text-amber-800">{text.taskForm.discoveryNotCrawlerTask}</div>
            <Link to="/agent" className="mt-2 inline-block font-medium underline">
              {text.taskForm.openDiscovery}
            </Link>
          </div>

          {adapterBuildTask.status === 'configuration_required' && (
            <div className="mt-2 rounded border border-amber-300 bg-white p-2">
              Selector discovery needs AO URL, provider JSON, and model before this adapter build task can run.{' '}
              <Link to="/settings" className="font-medium underline">
                Open Settings
              </Link>
            </div>
          )}

          {adapterBuildTask.error && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-700">
              {adapterBuildTask.error}
            </div>
          )}

          <button
            type="button"
            onClick={refreshAdapterBuildTask}
            className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-1 text-sm font-medium text-amber-900 shadow-sm hover:bg-amber-100"
          >
            Refresh adapter build status
          </button>
        </div>
      )}

      {challengeBuildTask && (
        <div
          className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-950"
          role="status"
          data-testid="challenge-build-task-status"
        >
          <div className="font-medium">Human verification handoff job created.</div>
          <div className="mt-1 break-all">{challengeBuildTask.normalizedUrl}</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>Status: {challengeBuildTask.status}</div>
            <div className="break-all">Job ID: {challengeBuildTask.challengeDiscoveryId}</div>
            <div className="break-all">Handoff: {challengeBuildTask.challengeDiscoveryId}</div>
            <div>Validation: {challengeBuildTask.validation?.valid === true ? 'passed' : '-'}</div>
          </div>

          <div className="mt-2 rounded border border-purple-200 bg-white p-2">
            {challengeStatusMessage}
          </div>

          <div className="mt-2 rounded border border-purple-200 bg-white p-2 text-purple-800">
            Create Task only queues challenge/discovery work. Human verification is handled from Task Details when a crawl task reaches
            <span className="font-medium"> waiting_verification</span>.
          </div>

          {challengeBuildTask.error && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-700">
              {challengeBuildTask.error}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          data-testid="task-mode-all"
          onClick={() => selectMode('all')}
          className={`rounded-lg border p-4 text-left shadow-sm transition ${
            mode === 'all' ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:bg-slate-50'
          }`}
        >
          <div className="font-semibold text-slate-900">{text.taskForm.allChaptersMode}</div>
          <p className="mt-2 text-sm text-slate-600">{text.taskForm.allChaptersDescription}</p>
        </button>

        <button
          type="button"
          data-testid="task-mode-chapters"
          onClick={() => selectMode('chapters')}
          className={`rounded-lg border p-4 text-left shadow-sm transition ${
            mode === 'chapters' ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:bg-slate-50'
          }`}
        >
          <div className="font-semibold text-slate-900">{text.taskForm.specificChaptersMode}</div>
          <p className="mt-2 text-sm text-slate-600">{text.taskForm.specificChaptersDescription}</p>
        </button>
      </div>

      {mode === 'all' && (
        <div>
          <label htmlFor="manga-url" className="block text-sm font-medium text-gray-700">
            {text.taskForm.mangaUrlLabel}
          </label>
          <input
            type="url"
            id="manga-url"
            value={mangaUrl}
            onChange={(event) => setMangaUrl(event.target.value)}
            placeholder={MANGA_URL_PLACEHOLDER}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
          <p className="mt-1 text-xs text-slate-500">{text.taskForm.mangaUrlHelp}</p>
        </div>
      )}

      {mode === 'chapters' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-gray-700">{text.taskForm.chapterUrlsLabel}</div>
              <p className="mt-1 text-xs text-slate-500">{text.taskForm.chapterUrlsHelp}</p>
            </div>
            <button
              type="button"
              onClick={addChapterUrl}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-lg font-semibold text-white shadow-sm hover:bg-blue-700"
              aria-label={text.taskForm.addChapterUrl}
              title={text.taskForm.addChapterUrl}
            >
              +
            </button>
          </div>

          {chapterUrls.map((chapterUrl, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="url"
                data-testid={`chapter-url-input-${index}`}
                value={chapterUrl}
                onChange={(event) => updateChapterUrl(index, event.target.value)}
                placeholder={CHAPTER_URL_PLACEHOLDER}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                required={index === 0}
                aria-label={`${text.taskForm.chapterUrlLabel} ${index + 1}`}
              />
              <button
                type="button"
                onClick={() => removeChapterUrl(index)}
                className="rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-600 shadow-sm hover:bg-slate-50"
                aria-label={text.taskForm.removeChapterUrl}
                title={text.taskForm.removeChapterUrl}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {mode && (
        <AdapterPreviewPanel
          preview={adapterPreview}
          loading={adapterPreviewLoading}
          error={adapterPreviewError}
        />
      )}

      {mode && (
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            {showAdvanced ? text.taskForm.hideAdvanced : text.taskForm.showAdvanced}
          </button>

          {showAdvanced && (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-4">
              <label htmlFor="priority" className="block text-sm font-medium text-gray-700">
                {text.taskForm.priorityLabel}
              </label>
              <input
                type="number"
                id="priority"
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
                min={0}
                max={10}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-slate-500">{text.taskForm.priorityHelp}</p>
            </div>
          )}
        </div>
      )}

      {mode && (
        <button
          type="submit"
          data-testid="create-task-submit"
          disabled={loading || !canSubmit}
          className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? text.taskForm.submitting : text.taskForm.submit}
        </button>
      )}
    </form>
  );
};

