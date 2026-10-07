import { useI18n } from '../../../text/i18n';
import type { SelectorDiscoveryJobSummary } from '@comiccrawler/shared';
import { StatusBadge, canRetryBuildJob, canReviewBuildJob, formatBuildJobMode, formatBuildJobTarget, formatDateTime } from '../widgets';

export function BuildJobsSection(props: {
  buildJobs: SelectorDiscoveryJobSummary[];
  buildJobsLoading: boolean;
  buildJobsError: string | null;
  retryingBuildJobId: string | null;
  reviewLoading: 'load' | 'test' | 'approve' | 'reject' | 'edit' | 'save' | 'revision' | null;
  fetchBuildJobs: () => Promise<void>;
  retryBuildJob: (id: string) => Promise<void>;
  openReviewJob: (id: string) => Promise<void>;
}) {
  const { text } = useI18n();
  const {
    buildJobs,
    buildJobsLoading,
    buildJobsError,
    retryingBuildJobId,
    reviewLoading,
    fetchBuildJobs,
    retryBuildJob,
    openReviewJob,
  } = props;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{text.agent.buildJobs}</h2>
          <p className="mt-1 text-sm text-slate-500">{text.agent.buildJobsDescription}</p>
          <p className="mt-1 text-xs text-slate-400">{text.agent.buildJobTaskBoundary}</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchBuildJobs()}
          disabled={buildJobsLoading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {buildJobsLoading ? `${text.agent.refresh}...` : text.agent.refresh}
        </button>
      </div>
      {buildJobsError && (
        <div className="border-b border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">{buildJobsError}</div>
      )}
      <div className="divide-y divide-slate-100">
        {buildJobs.map((job) => (
          <div key={job.id} className="px-6 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-900">{job.id}</span>
                  <StatusBadge text={text} value={job.status} />
                  {job.phase && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{job.phase}</span>}
                </div>
                <div className="mt-2 break-all text-sm text-slate-700">{job.normalizedUrl ?? job.url}</div>
                <div className="mt-1 text-xs text-slate-500">{job.hostname}</div>
              </div>
              <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2 lg:min-w-[30rem]">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobTarget}</div>
                  <div className="mt-1 font-medium text-slate-800">{formatBuildJobTarget(text, job)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobMode}</div>
                  <div className="mt-1 font-medium text-slate-800">{formatBuildJobMode(text, job)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobAdapter}</div>
                  <div className="mt-1 break-all font-medium text-slate-800">{job.adapterName ?? job.adapterId ?? job.baseAdapterId ?? '-'}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobUpdated}</div>
                  <div className="mt-1 font-medium text-slate-800">{formatDateTime(job.updatedAt)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobModel}</div>
                  <div className="mt-1 break-all font-medium text-slate-800">{job.model ?? '-'}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{text.agent.buildJobAoUrl}</div>
                  <div className="mt-1 break-all font-medium text-slate-800">{job.aoBaseUrl ?? '-'}</div>
                </div>
              </div>
            </div>
            {job.error && (
              <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
                <span className="font-medium">{text.agent.buildJobError}: </span>
                {String(job.error)}
              </div>
            )}
            {Boolean(job.implementationValidation) && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <span className="font-medium">implementationValidation: </span>
                <span className="font-mono">{JSON.stringify(job.implementationValidation)}</span>
              </div>
            )}
            {canRetryBuildJob(job) && (
              <button
                type="button"
                onClick={() => void retryBuildJob(job.id)}
                disabled={retryingBuildJobId === job.id}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {retryingBuildJobId === job.id ? `${text.agent.retryBuild}...` : text.agent.retryBuild}
              </button>
            )}
            {canReviewBuildJob(job) && (
              <button
                type="button"
                onClick={() => void openReviewJob(job.id)}
                disabled={reviewLoading === 'load'}
                className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reviewLoading === 'load' ? `${text.agent.reviewAdapterDraft}...` : text.agent.reviewAdapterDraft}
              </button>
            )}
          </div>
        ))}
        {buildJobs.length === 0 && !buildJobsLoading && (
          <div className="px-6 py-10 text-center text-sm text-slate-500">{text.agent.noBuildJobs}</div>
        )}
      </div>
    </section>
  );
}
