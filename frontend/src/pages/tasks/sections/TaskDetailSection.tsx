import { useI18n } from '../../../text/i18n';
import type { TaskDetail } from '../../../store';
import { ProgressBar } from '../../../components/ProgressBar';
import { MetadataAndChapterPanel, TaskFlowChart, canResumeTaskDetail, formatDate } from '../widgets';

export function TaskDetailSection(props: {
  detail: TaskDetail;
  taskAction: string | null;
  isVerificationBrowserOpening: boolean;
  isExternalVerificationUnreadable: boolean;
  pauseTask: (id: string) => void;
  cancelTask: (id: string) => void;
  handleResumeTask: (id: string) => void;
  handleDelete: (id: string) => void;
  openTaskOutputFolder: () => void;
  folderAction: string | null;
}) {
  const { text } = useI18n();
  const {
    detail,
    taskAction,
    isVerificationBrowserOpening,
    isExternalVerificationUnreadable,
    pauseTask,
    cancelTask,
    handleResumeTask,
    handleDelete,
    openTaskOutputFolder,
    folderAction,
  } = props;

  return (
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
    </>
  );
}
