import type { CrawlStage, TaskDetail } from '../../store';

export function formatDate(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export interface LocalBrowserProfile {
  id: string;
  name: string;
  directory?: string;
}

export interface LocalBrowserOption {
  id: string;
  name: string;
  executablePath: string;
  profiles: LocalBrowserProfile[];
  defaultProfileId?: string;
}

export type FlowNodeState = 'pending' | 'active' | 'done' | 'blocked' | 'failed' | 'skipped';

export interface FlowNode {
  key: CrawlStage;
  label: string;
  state: FlowNodeState;
}

export const FLOW_ORDER: CrawlStage[] = ['adapter', 'verification', 'metadata', 'chapter_list', 'chapter_images', 'downloading', 'completed'];
export const CHAPTER_ONLY_FLOW_ORDER: CrawlStage[] = ['adapter', 'verification', 'chapter_images', 'downloading', 'completed'];
export const FLOW_LABELS: Record<CrawlStage, string> = {
  adapter: 'Adapter',
  verification: 'Verification',
  metadata: 'Metadata',
  chapter_list: 'Chapter List',
  chapter_images: 'Chapter Images',
  downloading: 'Download',
  completed: 'Done',
  failed: 'Failed',
};

export function getDetailMode(detail: TaskDetail): 'all' | 'chapters' {
  return detail.task.mode === 'chapters' ? 'chapters' : 'all';
}

export function canResumeTaskDetail(detail: TaskDetail): boolean {
  return (
    detail.task.status === 'paused' ||
    detail.task.status === 'interrupted' ||
    detail.task.status === 'waiting_verification' ||
    ((detail.task.status === 'failed' || detail.task.status === 'completed') && detail.checkpoint?.resumable === true)
  );
}

export function getCurrentStage(detail: TaskDetail): CrawlStage {
  if (detail.task.status === 'waiting_verification') return 'verification';
  if (detail.task.status === 'completed') return 'completed';
  if (detail.task.status === 'failed') return detail.progress?.stage && detail.progress.stage !== 'completed' ? detail.progress.stage : 'downloading';
  return detail.progress?.stage ?? (detail.result?.metadata ? 'metadata' : 'adapter');
}

export function buildFlowNodes(detail: TaskDetail): FlowNode[] {
  const mode = getDetailMode(detail);
  const order = mode === 'chapters' ? CHAPTER_ONLY_FLOW_ORDER : FLOW_ORDER;
  const currentStage = getCurrentStage(detail);
  const currentIndex = order.indexOf(currentStage);
  const failed = detail.task.status === 'failed' || currentStage === 'failed';
  const blocked = detail.task.status === 'waiting_verification';

  return order.map((key, index) => {
    let state: FlowNodeState = currentIndex >= 0 && index < currentIndex ? 'done' : 'pending';
    if (key === currentStage || (currentStage === 'failed' && index === Math.max(currentIndex, 0))) {
      state = failed ? 'failed' : blocked && key === 'verification' ? 'blocked' : 'active';
    }
    return { key, label: FLOW_LABELS[key], state };
  });
}

export function mergePreviewFile(current: TaskDetail | null, previewFile: unknown): TaskDetail | null {
  if (!current || !previewFile || typeof previewFile !== 'object') return current;
  const raw = previewFile as Record<string, unknown>;
  const relativePath = typeof raw.relativePath === 'string' ? raw.relativePath : '';
  if (!relativePath) return current;
  const file = {
    name: typeof raw.name === 'string' ? raw.name : relativePath,
    relativePath,
    size: typeof raw.size === 'number' ? raw.size : 0,
    modifiedAt: typeof raw.modifiedAt === 'string' ? raw.modifiedAt : new Date().toISOString(),
    isImage: typeof raw.isImage === 'boolean' ? raw.isImage : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
  };
  const existing = current.preview?.files ?? [];
  const alreadyExists = existing.some((item) => item.relativePath === file.relativePath);
  const nextFiles = [file, ...existing.filter((item) => item.relativePath !== file.relativePath)].slice(0, 24);
  return {
    ...current,
    preview: {
      rootDir: current.preview?.rootDir ?? current.result?.outputPath ?? '',
      totalFiles: alreadyExists ? Math.max(current.preview?.totalFiles ?? 0, nextFiles.length) : Math.max((current.preview?.totalFiles ?? 0) + 1, nextFiles.length),
      files: nextFiles,
    },
  };
}

const nodeStateClass: Record<FlowNodeState, string> = {
  pending: 'border-slate-200 bg-slate-50 text-slate-500',
  active: 'border-blue-300 bg-blue-50 text-blue-800',
  done: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  blocked: 'border-purple-300 bg-purple-50 text-purple-800',
  failed: 'border-rose-300 bg-rose-50 text-rose-800',
  skipped: 'border-slate-200 bg-white text-slate-400',
};

const nodeDotClass: Record<FlowNodeState, string> = {
  pending: 'bg-slate-300',
  active: 'bg-blue-500',
  done: 'bg-emerald-500',
  blocked: 'bg-purple-500',
  failed: 'bg-rose-500',
  skipped: 'bg-slate-200',
};

export function TaskFlowChart({ detail }: { detail: TaskDetail }) {
  const nodes = buildFlowNodes(detail);
  const stageDetail = detail.progress?.stageDetail ?? detail.progress?.currentItems ?? detail.task.error ?? '-';

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4" data-testid="task-flow-chart">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Crawler flow</div>
          <div className="mt-1 text-sm text-slate-600">High-level pipeline progress for this task.</div>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {getDetailMode(detail) === 'chapters' ? 'Specific chapters' : 'All chapters'}
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-7">
        {nodes.map((node, index) => (
          <div key={node.key} className="flex items-center gap-2 md:block">
            <div className={`rounded-xl border px-3 py-3 text-sm font-medium ${nodeStateClass[node.state]}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${nodeDotClass[node.state]}`} />
                <span>{node.label}</span>
              </div>
              <div className="mt-1 text-xs capitalize opacity-75">{node.state.replace('_', ' ')}</div>
            </div>
            {index < nodes.length - 1 && (
              <div className="h-px flex-1 bg-slate-200 md:mx-auto md:mt-2 md:h-6 md:w-px" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Current stage</div>
        <div className="mt-1 font-medium text-slate-900">{stageDetail}</div>
      </div>
    </div>
  );
}

export function MetadataAndChapterPanel({ detail }: { detail: TaskDetail }) {
  const metadata = detail.result?.metadata ?? detail.progress?.metadata;
  const chapterListSummary = detail.progress?.chapterListSummary;
  const title = typeof metadata?.title === 'string' ? metadata.title : '-';
  const sourceUrl = typeof metadata?.url === 'string' ? metadata.url : detail.task.url;
  const coverUrl = typeof metadata?.coverUrl === 'string' ? metadata.coverUrl : undefined;
  const chapters = chapterListSummary?.chapters ?? [];

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" data-testid="task-live-extraction-panel">
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Metadata</div>
        <div className="mt-3 flex gap-3">
          {coverUrl && (
            <img src={coverUrl} alt={title} className="h-20 w-14 rounded border border-slate-200 object-cover" loading="lazy" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
            <div className="mt-1 break-all text-xs text-slate-500">{sourceUrl}</div>
            <div className="mt-2 text-xs text-slate-500">
              Chapters: {chapterListSummary?.totalChapters ?? (Array.isArray((metadata as any)?.chapters) ? (metadata as any).chapters.length : 0)}
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Chapter list</div>
          <div className="text-xs text-slate-500">{chapterListSummary?.totalChapters ?? 0} chapters</div>
        </div>
        {chapters.length > 0 ? (
          <div className="mt-3 max-h-52 overflow-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
            {chapters.slice(0, 20).map((chapter) => (
              <div key={`${chapter.id}-${chapter.url}`} className="px-3 py-2 text-sm">
                <div className="font-medium text-slate-800">{chapter.title || chapter.id}</div>
                <div className="mt-1 break-all text-xs text-slate-500">{chapter.url}</div>
              </div>
            ))}
            {chapterListSummary && chapterListSummary.totalChapters > chapters.slice(0, 20).length && (
              <div className="px-3 py-2 text-xs text-slate-500">
                Showing first {chapters.slice(0, 20).length} of {chapterListSummary.totalChapters} chapters.
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
            Chapter list has not been extracted yet.
          </div>
        )}
      </div>
    </div>
  );
}
