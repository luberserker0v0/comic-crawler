import type { AgentVersionSummary } from '../../store';
import { formatText, useI18n } from '../../text/i18n';
import type {
  AdapterListItem,
  SelectorDiscoveryJobSummary,
} from '@comiccrawler/shared';

export const badgeClassByStatus: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  candidate: 'bg-amber-100 text-amber-700',
  rolled_back: 'bg-rose-100 text-rose-700',
  rejected: 'bg-slate-100 text-slate-700',
  awaiting_review: 'bg-amber-100 text-amber-700',
  promoted: 'bg-green-100 text-green-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-rose-100 text-rose-700',
  in_progress: 'bg-blue-100 text-blue-700',
  running: 'bg-blue-100 text-blue-700',
  queued: 'bg-blue-100 text-blue-700',
  configuration_required: 'bg-amber-100 text-amber-700',
  known_adapter: 'bg-slate-100 text-slate-700',
};

export type PendingAction =
  | { type: 'promote'; adapterId: string; version: string }
  | { type: 'reject'; adapterId: string; version: string }
  | { type: 'rollback'; adapterId: string; version?: string }
  | {
      type: 'deleteAdapter';
      adapterId: string;
      adapterName?: string;
      implementationKind?: AdapterListItem['implementationKind'];
      sourcePath?: string;
      sourceWillBeDeleted?: boolean;
    };

export function getBadgeLabel(
  text: ReturnType<typeof useI18n>['text'],
  value: string | null | undefined
): string {
  if (!value) {
    return '-';
  }

  return text.agent.statusLabels[value as keyof typeof text.agent.statusLabels] ?? value;
}

export function StatusBadge({
  text,
  value,
}: {
  text: ReturnType<typeof useI18n>['text'];
  value: string | null | undefined;
}) {
  if (!value) {
    return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">-</span>;
  }

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${badgeClassByStatus[value] ?? 'bg-slate-100 text-slate-700'}`}>
      {getBadgeLabel(text, value)}
    </span>
  );
}

export function formatActionTitle(text: ReturnType<typeof useI18n>['text'], action: PendingAction): string {
  if (action.type === 'promote') return text.agent.pendingActions.promoteTitle;
  if (action.type === 'reject') return text.agent.pendingActions.rejectTitle;
  if (action.type === 'deleteAdapter') return text.agent.pendingActions.deleteAdapterTitle;
  return text.agent.pendingActions.rollbackTitle;
}

export function formatActionDescription(text: ReturnType<typeof useI18n>['text'], action: PendingAction): string {
  if (action.type === 'promote') {
    return formatText(text.agent.pendingActions.promoteDescription, action);
  }

  if (action.type === 'reject') {
    return formatText(text.agent.pendingActions.rejectDescription, action);
  }

  if (action.type === 'deleteAdapter') {
    return formatText(text.agent.pendingActions.deleteAdapterDescription, {
      adapterId: action.adapterId,
      adapterName: action.adapterName ?? action.adapterId,
      implementationKind: action.implementationKind ?? '-',
      sourcePath: action.sourcePath ?? '-',
    });
  }

  const rollbackAction = action as Extract<PendingAction, { type: 'rollback' }>;
  return rollbackAction.version
    ? formatText(text.agent.pendingActions.rollbackDescriptionWithVersion, {
      adapterId: rollbackAction.adapterId,
      version: rollbackAction.version,
    })
    : formatText(text.agent.pendingActions.rollbackDescriptionWithoutVersion, { adapterId: rollbackAction.adapterId });
}

export function VersionDetails({
  text,
  version,
}: {
  text: ReturnType<typeof useI18n>['text'];
  version: AgentVersionSummary | null | undefined;
}) {
  if (!version) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        {text.agent.versionDetailsEmpty}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{version.version}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {text.agent.repairMode}: {version.repairMode ?? '-'} | {text.agent.basedOn}: {version.basedOnVersion ?? text.agent.runtimeBaseline}
          </p>
        </div>
        <StatusBadge text={text} value={version.status} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.validation}</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">
            {version.validation?.syntaxValid === false ? text.agent.syntaxFailed : text.agent.syntaxPassed}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.fixturesPassed}</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">{version.testResults?.passed ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{text.agent.fixturesFailed}</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">{version.testResults?.failed ?? 0}</div>
        </div>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">{text.agent.fixtureResults}</h4>
        <div className="mt-3 space-y-3">
          {version.validation?.fixtureResults?.map((fixture) => (
            <div key={`${version.version}-${fixture.fixtureName}`} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">{fixture.fixtureName}</div>
                <StatusBadge text={text} value={fixture.valid ? 'valid' : 'invalid'} />
              </div>
              {fixture.errors.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm text-rose-700">
                  {fixture.errors.map((error) => (
                    <li key={`${fixture.fixtureName}-${error}`} className="rounded-lg bg-rose-50 px-3 py-2">
                      {error}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {text.agent.fixtureMatched}
                </div>
              )}
            </div>
          )) ?? (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              {text.agent.noFixtureDetails}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function formatCooldown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function isActiveBuildJob(job: SelectorDiscoveryJobSummary): boolean {
  return job.status === 'queued' || job.status === 'running';
}

export function canRetryBuildJob(job: SelectorDiscoveryJobSummary): boolean {
  return job.status === 'invalid' || job.status === 'failed';
}

export function canReviewBuildJob(job: SelectorDiscoveryJobSummary): boolean {
  return job.status === 'awaiting_review' && Boolean(job.adapterImplementationTs?.trim());
}

export function formatBuildJobTarget(text: ReturnType<typeof useI18n>['text'], job: SelectorDiscoveryJobSummary): string {
  return job.target === 'chapter-only' ? text.agent.buildJobChapterOnly : text.agent.buildJobFull;
}

export function formatBuildJobMode(text: ReturnType<typeof useI18n>['text'], job: SelectorDiscoveryJobSummary): string {
  return job.promotionMode === 'augment' ? text.agent.buildJobAugment : text.agent.buildJobCreate;
}

export function formatDateTime(value: string | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function extractRepresentativeChapterUrl(job: SelectorDiscoveryJobSummary): string | undefined {
  const source = [job.phase1Markdown, job.candidateMarkdown, job.reviewNotesMarkdown].filter(Boolean).join('\n');
  const explicit = /Representative Chapter URL[\s\S]*?(https?:\/\/[^\s)<>"']+)/i.exec(source)?.[1];
  if (explicit) return explicit;
  return /https?:\/\/[^\s)<>"']*\/(?:chapter|mangaread)[^\s)<>"']*/i.exec(source)?.[0];
}

export function defaultTestUrlForFunction(job: SelectorDiscoveryJobSummary, functionId: string): string {
  if (functionId === 'extractChapterImageUrls') {
    return extractRepresentativeChapterUrl(job) ?? job.normalizedUrl ?? job.url;
  }
  return job.normalizedUrl ?? job.url;
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatCapabilityValue(value: boolean): string {
  return value ? 'O' : 'X';
}

export function formatImplementationKind(text: ReturnType<typeof useI18n>['text'], kind: AdapterListItem['implementationKind']): string {
  if (!kind) return '-';
  return text.agent.implementationKinds[kind as keyof typeof text.agent.implementationKinds] ?? kind;
}
