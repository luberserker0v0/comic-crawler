import { formatText, useI18n } from '../../../text/i18n';
import { formatActionDescription, formatActionTitle, type PendingAction } from '../widgets';

export function PendingActionBanner(props: {
  pendingAction: PendingAction;
  deleteAdapterConfirmation: string;
  setDeleteAdapterConfirmation: (value: string) => void;
  setPendingAction: (value: PendingAction | null) => void;
  runPendingAction: () => void;
  actionLoading: boolean;
  deleteAdapterLoading: boolean;
  deleteConfirmationMatches: boolean;
}) {
  const { text } = useI18n();
  const {
    pendingAction,
    deleteAdapterConfirmation,
    setDeleteAdapterConfirmation,
    setPendingAction,
    runPendingAction,
    actionLoading,
    deleteAdapterLoading,
    deleteConfirmationMatches,
  } = props;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-amber-900">{formatActionTitle(text, pendingAction)}</h2>
          <p className="mt-1 text-sm text-amber-800">{formatActionDescription(text, pendingAction)}</p>
          {pendingAction.type === 'deleteAdapter' && pendingAction.sourceWillBeDeleted && (
            <div className="mt-3 max-w-2xl rounded-lg border border-rose-200 bg-white p-3 text-sm text-rose-800">
              <div>{text.agent.pendingActions.deleteSourcePath}: <span className="font-mono">{pendingAction.sourcePath ?? '-'}</span></div>
              <label className="mt-3 block">
                <span className="font-medium">{formatText(text.agent.pendingActions.typeAdapterIdToConfirm, { adapterId: pendingAction.adapterId })}</span>
                <input
                  value={deleteAdapterConfirmation}
                  onChange={(event) => setDeleteAdapterConfirmation(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-rose-200 px-3 py-2 font-mono text-sm text-slate-900"
                  placeholder={pendingAction.adapterId}
                />
              </label>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setPendingAction(null);
              setDeleteAdapterConfirmation('');
            }}
            className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900"
          >
            {text.agent.pendingActions.cancel}
          </button>
          <button
            onClick={runPendingAction}
            disabled={actionLoading || deleteAdapterLoading || !deleteConfirmationMatches}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionLoading || deleteAdapterLoading ? text.agent.pendingActions.working : text.agent.pendingActions.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
