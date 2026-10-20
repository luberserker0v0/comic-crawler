import type { TaskDetail } from '../../../store';
import { useI18n } from '../../../text/i18n';

export function VerificationHandoffSection(props: {
  detail: TaskDetail;
  challengeJob: any | null;
  challengeAction: string | null;
  challengeError: string | null;
  shouldReopenVerificationBrowser: boolean;
  isChallengeJobUnavailable: boolean;
  openVerificationBrowser: () => void;
}) {
  const { text } = useI18n();
  if (!props.detail.result) return null;
  return <div className="rounded-2xl border border-purple-200 bg-purple-50 p-6 text-purple-950 shadow" data-testid="task-verification-handoff">
    <VerificationSummary props={props} text={text} />
    <VerificationError props={props} text={text} />
    {!props.isChallengeJobUnavailable && <VerificationAction props={props} text={text} />}
  </div>;
}

type VerificationProps = Parameters<typeof VerificationHandoffSection>[0];
type VerificationText = ReturnType<typeof useI18n>['text'];

function VerificationSummary({ props, text }: { props: VerificationProps; text: VerificationText }) {
  return <div><h3 className="text-lg font-semibold">{text.taskManager.verificationRequired}</h3>
    <p className="mt-2 text-sm text-purple-800">{text.taskManager.verificationDescription}</p>
    <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
      <div className="break-all">{text.taskManager.challengeJob}: {props.detail.result?.challengeDiscoveryId}</div>
      <div>{text.taskList.status}: {props.challengeJob?.status ?? props.detail.result?.challengeStatus ?? '-'}</div>
      <div className="break-all md:col-span-2">URL: {props.challengeJob?.normalizedUrl ?? props.detail.task.url}</div>
    </div>
  </div>;
}

function VerificationError({ props, text }: { props: VerificationProps; text: VerificationText }) {
  if (props.isChallengeJobUnavailable) return <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="challenge-job-unavailable-message">{text.taskManager.verificationExpired}</div>;
  if (props.challengeError) return <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{props.challengeError}</div>;
  return null;
}

function VerificationAction({ props, text }: { props: VerificationProps; text: VerificationText }) {
  const label = props.challengeAction === 'open-verification-browser' ? text.taskManager.openingBrowser
    : props.shouldReopenVerificationBrowser ? text.taskManager.reopenVerificationBrowser : text.taskManager.openVerificationBrowser;
  return <div className="mt-4 rounded-xl border border-purple-200 bg-white p-4">
    <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">{text.taskManager.remoteBrowserNotice}</div>
    {props.shouldReopenVerificationBrowser && <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{text.taskManager.reopenBrowserNotice}</p>}
    <button type="button" onClick={() => void props.openVerificationBrowser()} disabled={props.challengeAction !== null}
      className="mt-4 rounded-md bg-purple-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-800 disabled:opacity-50"
      data-testid="open-verification-browser-button">{label}</button>
  </div>;
}
