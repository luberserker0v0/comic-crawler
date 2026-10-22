import { useI18n } from '../../text/i18n';
import { formatText } from '../../text/format';
import type { UIText } from '../../text/zhTW';

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
    parseMode: 'playwright';
    capabilities: { verification?: boolean; metadata: boolean; chapterImages: boolean };
  };
  matchedAdapter?: {
    id: string;
    name: string;
    parseMode: 'playwright';
    capabilities: { verification?: boolean; metadata: boolean; chapterImages: boolean };
  };
  requiredCapabilities: { metadata?: boolean; chapterImages?: boolean };
  discoveryTarget: 'full' | 'chapter-only';
}

export function getChallengeStatusMessage(status: string, text: UIText['taskForm']): string {
  switch (status) {
    case 'strategy_awaiting_review':
      return text.challengeAwaitingReview;
    case 'strategy_promoted':
      return text.challengePromoted;
    case 'browser_open':
      return text.challengeBrowserOpen;
    case 'challenge_required':
      return text.challengeRequired;
    case 'access_blocked':
      return text.challengeAccessBlocked;
    case 'ready':
      return text.challengeReady;
    default:
      return text.challengeDetected;
  }
}

export function AdapterPreviewPanel(props: {
  preview: AdapterResolutionPreview | null;
  loading: boolean;
  error: string | null;
}) {
  const { preview, loading, error } = props;
  const { text } = useI18n();
  if (loading) return <PreviewMessage tone="loading" message={text.taskForm.resolvingAdapter} />;
  if (error) return <PreviewMessage tone="error" message={formatText(text.taskForm.adapterResolutionFailed, { error })} />;
  if (!preview) return null;
  const adapter = preview.adapter ?? preview.matchedAdapter, canUse = preview.status === 'matched';
  const colors = canUse ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900';
  return <div className={`rounded-md border p-3 text-sm ${colors}`} data-testid="adapter-resolution-preview">
    <PreviewStatus preview={preview} text={text} />
    <PreviewDetails preview={preview} text={text} />
    {adapter && <ResolvedAdapter adapter={adapter} text={text} />}
    {!canUse && <div className="mt-2">{preview.status === 'capability_mismatch'
      ? text.taskForm.buildMissingCapability : text.taskForm.buildNewAdapter}</div>}
  </div>;
}

type PreviewText = ReturnType<typeof useI18n>['text'];

function PreviewMessage({ tone, message }: { tone: 'loading' | 'error'; message: string }) {
  const colors = tone === 'loading' ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-red-200 bg-red-50 text-red-700';
  return <div className={`rounded-md border p-3 text-sm ${colors}`} data-testid="adapter-resolution-preview">{message}</div>;
}

function PreviewStatus({ preview, text }: { preview: AdapterResolutionPreview; text: PreviewText }) {
  const label = preview.status === 'matched' ? text.taskForm.adapterMatched
    : preview.status === 'capability_mismatch' ? text.taskForm.adapterCapabilityMismatch : text.taskForm.adapterNotFound;
  return <div className="font-medium">{label}</div>;
}

function PreviewDetails({ preview, text }: { preview: AdapterResolutionPreview; text: PreviewText }) {
  return <div className="mt-2 grid gap-2 md:grid-cols-2">
    <div className="break-all">URL: {preview.url}</div><div>{text.taskForm.domain}: {preview.hostname}</div>
    <div>{text.taskForm.taskMode}: {preview.mode === 'chapters' ? text.taskForm.specificChaptersMode : text.taskForm.allChaptersMode}</div>
    <div>{text.taskForm.discoveryTarget}: {preview.discoveryTarget}</div>
  </div>;
}

type PreviewAdapter = NonNullable<AdapterResolutionPreview['adapter']>;

function ResolvedAdapter({ adapter, text }: { adapter: PreviewAdapter; text: PreviewText }) {
  return <div className="mt-2 rounded border border-white/70 bg-white p-2">
    <div className="font-medium">{adapter.name} <span className="font-mono text-xs">({adapter.id})</span></div>
    <div className="mt-1 text-xs">{text.taskForm.domAcquisition}: {adapter.parseMode}</div>
    <div className="mt-1 text-xs">{text.taskForm.capabilities}: {text.taskForm.verification} {adapter.capabilities.verification ? 'O' : 'X'} / {text.taskForm.metadata} {adapter.capabilities.metadata ? 'O' : 'X'} / {text.taskForm.images} {adapter.capabilities.chapterImages ? 'O' : 'X'}</div>
  </div>;
}
