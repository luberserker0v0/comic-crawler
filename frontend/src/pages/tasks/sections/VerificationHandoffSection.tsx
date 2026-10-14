import type { TaskDetail } from '../../../store';

export function VerificationHandoffSection(props: {
  detail: TaskDetail;
  challengeJob: any | null;
  challengeAction: string | null;
  challengeError: string | null;
  shouldReopenVerificationBrowser: boolean;
  isChallengeJobUnavailable: boolean;
  openVerificationBrowser: () => void;
}) {
  const {
    detail,
    challengeJob,
    challengeAction,
    challengeError,
    shouldReopenVerificationBrowser,
    isChallengeJobUnavailable,
    openVerificationBrowser,
  } = props;

  if (!detail.result) return null;

  return (
    <div
      className="rounded-2xl border border-purple-200 bg-purple-50 p-6 text-purple-950 shadow"
      data-testid="task-verification-handoff"
    >
      <div>
        <h3 className="text-lg font-semibold">Human verification required</h3>
        <p className="mt-2 text-sm text-purple-800">
          The adapter matched this URL, but crawling reached a human verification page. Open an isolated browser from here, complete verification as a human, then use Continue to resume this task from its checkpoint.
        </p>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div className="break-all">Challenge job: {detail.result.challengeDiscoveryId}</div>
          <div>Status: {challengeJob?.status ?? detail.result.challengeStatus ?? '-'}</div>
          <div className="break-all md:col-span-2">URL: {challengeJob?.normalizedUrl ?? detail.task.url}</div>
        </div>
      </div>

      {isChallengeJobUnavailable ? (
        <div
          className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          data-testid="challenge-job-unavailable-message"
        >
          This verification handoff expired or was removed. Click Continue to recreate the handoff, then open the browser from this task detail page.
        </div>
      ) : challengeError ? (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {challengeError}
        </div>
      ) : null}

      {!isChallengeJobUnavailable && (
      <div className="mt-4 rounded-xl border border-purple-200 bg-white p-4">
        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          ComicCrawler will open this task in the configured remote Playwright service. No browser is launched in the ComicCrawler process or container.
        </div>
        {shouldReopenVerificationBrowser && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            ComicCrawler cannot read the previous remote browser session. Reopen it from here.
          </p>
        )}

        <button
          type="button"
          onClick={() => void openVerificationBrowser()}
          disabled={challengeAction !== null}
          className="mt-4 rounded-md bg-purple-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-800 disabled:opacity-50"
          data-testid="open-verification-browser-button"
        >
          {challengeAction === 'open-verification-browser'
            ? 'Opening browser...'
            : shouldReopenVerificationBrowser
              ? 'Reopen browser for verification'
              : 'Open browser for verification'}
        </button>
      </div>
      )}
    </div>
  );
}
