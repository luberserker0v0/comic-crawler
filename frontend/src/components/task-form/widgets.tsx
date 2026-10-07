export type TaskMode = 'all' | 'chapters';

export const MANGA_URL_PLACEHOLDER = 'https://example.com/manga/{manga_name}/';
export const CHAPTER_URL_PLACEHOLDER = 'https://example.com/manga/{manga_name}/{manga_chapter}';

export interface AdapterBuildTaskResult {
  discoveryId: string;
  status: string;
  normalizedUrl: string;
  target?: 'full' | 'chapter-only';
  reason?: string;
  adapterId?: string;
  adapterName?: string;
  capabilities?: { verification?: boolean; metadata: boolean; chapterImages: boolean };
  requiredCapabilities?: { metadata?: boolean; chapterImages?: boolean };
  error?: string;
}

export interface ChallengeBuildTaskResult {
  challengeDiscoveryId: string;
  status: string;
  normalizedUrl: string;
  reason?: string;
  error?: string;
  strategyId?: string;
  validation?: { valid: boolean; errors?: string[]; warnings?: string[] };
}

export interface AdapterResolutionPreview {
  status: 'matched' | 'capability_mismatch' | 'not_found';
  url: string;
  hostname: string;
  mode: TaskMode;
  adapter?: {
    id: string;
    name: string;
    parseMode: string;
    capabilities: { verification?: boolean; metadata: boolean; chapterImages: boolean };
  };
  matchedAdapter?: {
    id: string;
    name: string;
    parseMode: string;
    capabilities: { verification?: boolean; metadata: boolean; chapterImages: boolean };
  };
  requiredCapabilities: { metadata?: boolean; chapterImages?: boolean };
  discoveryTarget: 'full' | 'chapter-only';
}

export function getChallengeStatusMessage(status: string): string {
  switch (status) {
    case 'strategy_awaiting_review':
      return 'Legacy diagnostic strategy review status. The normal crawl path uses human verification handoff from Task Details.';
    case 'strategy_promoted':
      return 'Challenge handling is available. If a crawl task later needs human verification, continue from that task detail page.';
    case 'browser_open':
      return 'A verification browser was opened for a task. Continue from the task detail page.';
    case 'external_browser_open':
      return 'A verification browser was opened for a task. Continue from the task detail page.';
    case 'challenge_required':
      return 'Human verification is still required. Open the affected task detail page to perform the handoff.';
    case 'access_blocked':
      return 'The site explicitly blocked this browser/session. ComicCrawler stopped before selector discovery so blocked HTML will not become an adapter.';
    case 'ready':
      return 'Human verification succeeded. ComicCrawler saved this browser profile for the site, and later renders can reuse it.';
    default:
      return 'ComicCrawler detected a browser challenge before adapter discovery. Create Task only reports this status; verification runs from Task Details.';
  }
}

export function AdapterPreviewPanel(props: {
  preview: AdapterResolutionPreview | null;
  loading: boolean;
  error: string | null;
}) {
  const { preview, loading, error } = props;

  if (loading) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600" data-testid="adapter-resolution-preview">
        Resolving adapter for this URL...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="adapter-resolution-preview">
        Adapter resolution failed: {error}
      </div>
    );
  }

  if (!preview) return null;

  const adapter = preview.adapter ?? preview.matchedAdapter;
  const canUse = preview.status === 'matched';

  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        canUse
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
      data-testid="adapter-resolution-preview"
    >
      <div className="font-medium">
        {canUse
          ? 'This URL will use the following adapter.'
          : preview.status === 'capability_mismatch'
            ? 'A domain adapter exists, but it cannot cover this task mode.'
            : 'No adapter matches this URL yet.'}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="break-all">URL: {preview.url}</div>
        <div>Domain: {preview.hostname}</div>
        <div>Task mode: {preview.mode === 'chapters' ? 'Specific chapters' : 'All chapters'}</div>
        <div>Discovery target if needed: {preview.discoveryTarget}</div>
      </div>
      {adapter && (
        <div className="mt-2 rounded border border-white/70 bg-white p-2">
          <div className="font-medium">{adapter.name} <span className="font-mono text-xs">({adapter.id})</span></div>
          <div className="mt-1 text-xs">Parse mode: {adapter.parseMode}</div>
          <div className="mt-1 text-xs">
            Capabilities: Verification {adapter.capabilities.verification ? 'O' : 'X'} / Metadata {adapter.capabilities.metadata ? 'O' : 'X'} / Images {adapter.capabilities.chapterImages ? 'O' : 'X'}
          </div>
        </div>
      )}
      {!canUse && (
        <div className="mt-2">
          ComicCrawler will create an adapter build task to {preview.status === 'capability_mismatch' ? '補足缺少的功能' : '新增 adapter'}.
        </div>
      )}
    </div>
  );
}
