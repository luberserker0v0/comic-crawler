import { useI18n } from '../../../text/i18n';
import type { TaskDetail } from '../../../store';
import { ProgressBar } from '../../../components/ProgressBar';
import { MetadataAndChapterPanel, TaskFlowChart, canResumeTaskDetail, formatDate } from '../widgets';

interface TaskDetailSectionProps {
  detail: TaskDetail;
  taskAction: string | null;
  isVerificationBrowserOpening: boolean;
  pauseTask: (id: string) => void;
  cancelTask: (id: string) => void;
  handleResumeTask: (id: string) => void;
  handleDelete: (id: string) => void;
  openTaskOutputFolder: () => void;
  folderAction: string | null;
}

export function TaskDetailSection(props: TaskDetailSectionProps) {
  const { text } = useI18n();
  return <div className="rounded-2xl bg-white p-6 shadow">
    <TaskHeader props={props} text={text} />
    <TaskTiming detail={props.detail} text={text} />
    <TaskFlowChart detail={props.detail} />
    <TaskProgress detail={props.detail} text={text} />
    <TaskCheckpoint detail={props.detail} text={text} />
    <MetadataAndChapterPanel detail={props.detail} />
    <TaskResults detail={props.detail} text={text} />
    <TaskOutput props={props} text={text} />
  </div>;
}

type DetailProps = Parameters<typeof TaskDetailSection>[0];
type DetailText = ReturnType<typeof useI18n>['text'];

function TaskHeader({ props, text }: { props: DetailProps; text: DetailText }) {
  return <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
    <div className="min-w-0"><h2 className="text-xl font-semibold text-slate-900">{text.taskManager.detailTitle}</h2>
      <div className="mt-2 text-sm text-slate-600">{props.detail.task.id}</div>
      <div className="mt-1 break-all text-sm text-slate-500">{props.detail.task.url}</div></div>
    <TaskActions props={props} text={text} />
  </div>;
}

function TaskActions({ props, text }: { props: DetailProps; text: DetailText }) {
  const { detail } = props;
  const cancellable = ['running', 'pending', 'paused'].includes(detail.task.status);
  const deletable = ['completed', 'failed', 'cancelled', 'interrupted', 'waiting_verification'].includes(detail.task.status);
  return <div className="flex flex-wrap gap-2">
    {detail.task.status === 'running' && <TaskButton color="bg-amber-500" onClick={() => props.pauseTask(detail.task.id)}>{text.taskList.pause}</TaskButton>}
    {canResumeTaskDetail(detail) && <ResumeButton props={props} text={text} />}
    {cancellable && <TaskButton color="bg-rose-600" onClick={() => props.cancelTask(detail.task.id)}>{text.taskList.cancel}</TaskButton>}
    {deletable && <TaskButton color="bg-slate-700" onClick={() => props.handleDelete(detail.task.id)}>{text.taskList.delete}</TaskButton>}
  </div>;
}

function ResumeButton({ props, text }: { props: DetailProps; text: DetailText }) {
  const label = props.isVerificationBrowserOpening ? text.taskManager.openingBrowser
    : props.taskAction === 'resume' ? text.taskManager.continuing : text.taskList.resume;
  return <button onClick={() => void props.handleResumeTask(props.detail.task.id)}
    disabled={props.taskAction !== null || props.isVerificationBrowserOpening}
    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{label}</button>;
}

function TaskButton({ color, onClick, children }: { color: string; onClick(): void; children: React.ReactNode }) {
  return <button onClick={() => void onClick()} className={`rounded-lg ${color} px-4 py-2 text-sm font-medium text-white`}>{children}</button>;
}

function TaskTiming({ detail, text }: { detail: TaskDetail; text: DetailText }) {
  const status = text.taskList.statusLabels[detail.task.status as keyof typeof text.taskList.statusLabels] ?? detail.task.status;
  const items: Array<[string, string | number]> = [[text.taskList.status, status], [text.taskManager.createdAt, formatDate(detail.task.createdAt)],
    [text.taskManager.startedAt, formatDate(detail.task.startedAt)],
    [text.taskManager.completedAt, formatDate(detail.task.completedAt)]];
  return <StatGrid items={items} />;
}

function StatGrid({ items }: { items: Array<[string, string | number]> }) {
  return <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{items.map(([label, value]) =>
    <div key={label} className="rounded-xl border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value}</div></div>)}</div>;
}

function TaskProgress({ detail, text }: { detail: TaskDetail; text: DetailText }) {
  const progress = detail.progress;
  if (!progress || progress.totalItems <= 0) return null;
  return <div className="mt-6 rounded-xl border border-slate-200 p-4">
    <ProgressBar current={progress.completedItems} total={progress.totalItems} label={text.taskList.progress} />
    <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
      <div>{text.taskManager.downloadedImages}: {progress.completedItems}</div>
      <div>{text.taskManager.failedImages}: {progress.failedItems}</div>
      <div>{text.taskManager.currentItem}: {progress.stageDetail ?? progress.currentItems ?? '-'}</div>
    </div>
  </div>;
}

function TaskCheckpoint({ detail, text }: { detail: TaskDetail; text: DetailText }) {
  const checkpoint = detail.checkpoint;
  if (!checkpoint) return null;
  const items = [[text.taskManager.currentChapter, checkpoint.currentChapter ?? '-'],
    [text.taskManager.completedImages, checkpoint.completedImages], [text.taskManager.failedImages, checkpoint.failedImages],
    [text.taskManager.checkpointUpdated, formatDate(checkpoint.updatedAt)]] as Array<[string, string | number]>;
  return <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
    <div className="text-xs uppercase tracking-[0.25em] text-emerald-500">{text.taskManager.resumeCheckpoint}</div>
    <div className="mt-3 grid gap-3 md:grid-cols-4">{items.map(([label, value]) => <CheckpointItem key={label} label={label} value={value} />)}</div>
    <div className="mt-2 text-xs text-emerald-700">{checkpoint.resumable ? text.taskManager.checkpointResumable : text.taskManager.checkpointComplete}</div>
  </div>;
}

function CheckpointItem({ label, value }: { label: string; value: string | number }) {
  return <div><div className="text-xs text-emerald-700">{label}</div><div className="mt-1 font-medium">{value}</div></div>;
}

function TaskResults({ detail, text }: { detail: TaskDetail; text: DetailText }) {
  const title = typeof detail.result?.metadata?.title === 'string' ? detail.result.metadata.title : '-';
  const items = [[text.taskManager.metadataTitle, title], [text.taskManager.totalImages, detail.result?.totalImages ?? 0],
    [text.taskManager.downloadedImages, detail.result?.downloadedImages ?? 0],
    [text.taskManager.failedImages, detail.result?.failedImages ?? 0]] as Array<[string, string | number]>;
  return <StatGrid items={items} />;
}

function TaskOutput({ props, text }: { props: DetailProps; text: DetailText }) {
  const outputPath = props.detail.result?.outputPath;
  return <dl className="mt-6 space-y-4 text-sm"><div><dt className="text-slate-400">{text.taskManager.outputPath}</dt>
    <dd className="mt-1 flex flex-col gap-2 break-all font-medium text-slate-900 sm:flex-row sm:items-center"><span>{outputPath ?? '-'}</span>
      {outputPath && <button type="button" onClick={() => void props.openTaskOutputFolder()} disabled={props.folderAction !== null}
        className="w-fit rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {props.folderAction === 'open-output' ? 'Opening...' : 'Open folder'}</button>}</dd></div>
    {props.detail.task.error && <div><dt className="text-slate-400">{text.taskManager.error}</dt>
      <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-rose-700">{props.detail.task.error}</dd></div>}
  </dl>;
}
