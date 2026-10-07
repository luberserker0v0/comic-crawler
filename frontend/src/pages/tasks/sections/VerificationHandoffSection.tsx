import type { TaskDetail } from '../../../store';
import type { LocalBrowserOption } from '../widgets';

export function VerificationHandoffSection(props: {
  detail: TaskDetail;
  challengeJob: any | null;
  challengeAction: string | null;
  challengeError: string | null;
  browserOptions: LocalBrowserOption[];
  browserExecutablePath: string;
  setBrowserExecutablePath: (value: string) => void;
  shouldReopenVerificationBrowser: boolean;
  isExternalVerificationUnreadable: boolean;
  isChallengeJobUnavailable: boolean;
  browseBrowserExecutable: () => void;
  openVerificationBrowser: () => void;
}) {
  const {
    detail,
    challengeJob,
    challengeAction,
    challengeError,
    browserOptions,
    browserExecutablePath,
    setBrowserExecutablePath,
    shouldReopenVerificationBrowser,
    isExternalVerificationUnreadable,
    isChallengeJobUnavailable,
    browseBrowserExecutable,
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
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="block">
            <span className="text-sm font-medium text-purple-950">Local browser executable</span>
            <input
              type="text"
              value={browserExecutablePath}
              onChange={(event) => setBrowserExecutablePath(event.target.value)}
              placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
              className="mt-1 block w-full rounded-md border-purple-200 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
              data-testid="verification-browser-path-input"
            />
          </label>
          <button
            type="button"
            onClick={() => void browseBrowserExecutable()}
            disabled={challengeAction !== null}
            className="self-end rounded-md border border-purple-300 bg-white px-3 py-2 text-sm font-medium text-purple-900 shadow-sm hover:bg-purple-100 disabled:opacity-50"
          >
            {challengeAction === 'browse-browser' ? 'Browsing...' : 'Browse'}
          </button>
        </div>

        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          ComicCrawler will open an isolated verification profile for this task. Your normal Chrome/Brave profiles are not used.
        </div>

        {browserOptions.length === 0 && (
          <p className="mt-2 text-xs text-purple-800">
            No local browser was auto-detected. Enter the browser executable path manually, or use Browse on Windows.
          </p>
        )}
        {browserExecutablePath && (
          <p className="mt-2 text-xs text-purple-800">
            Recommended: ComicCrawler will open a separate browser profile so your normal Brave/Chrome session can keep running the WebUI.
          </p>
        )}
        {shouldReopenVerificationBrowser && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            ComicCrawler cannot read the previous browser session. Close all windows for this browser/profile, then reopen it from here.
          </p>
        )}
        {isExternalVerificationUnreadable && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            This browser window opened, but ComicCrawler cannot read it because no Chromium debugging connection was exposed. Use the isolated profile, or close every Chrome window that uses the selected profile and open it again from here.
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
