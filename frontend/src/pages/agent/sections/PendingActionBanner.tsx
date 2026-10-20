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
  return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <ActionDescription props={props} text={text} />
      <ActionButtons props={props} text={text} />
    </div>
  </div>;
}

type BannerProps = Parameters<typeof PendingActionBanner>[0];
type BannerText = ReturnType<typeof useI18n>['text'];

function ActionDescription({ props, text }: { props: BannerProps; text: BannerText }) {
  const action = props.pendingAction;
  return <div><h2 className="text-lg font-semibold text-amber-900">{formatActionTitle(text, action)}</h2>
    <p className="mt-1 text-sm text-amber-800">{formatActionDescription(text, action)}</p>
    {action.type === 'deleteAdapter' && action.sourceWillBeDeleted && <DeleteConfirmation props={props} text={text} />}
  </div>;
}

function DeleteConfirmation({ props, text }: { props: BannerProps; text: BannerText }) {
  const action = props.pendingAction as Extract<PendingAction, { type: 'deleteAdapter' }>;
  return <div className="mt-3 max-w-2xl rounded-lg border border-rose-200 bg-white p-3 text-sm text-rose-800">
    <div>{text.agent.pendingActions.deleteSourcePath}: <span className="font-mono">{action.sourcePath ?? '-'}</span></div>
    <label className="mt-3 block"><span className="font-medium">
      {formatText(text.agent.pendingActions.typeAdapterIdToConfirm, { adapterId: action.adapterId })}</span>
      <input value={props.deleteAdapterConfirmation} onChange={(event) => props.setDeleteAdapterConfirmation(event.target.value)}
        className="mt-2 w-full rounded-lg border border-rose-200 px-3 py-2 font-mono text-sm text-slate-900" placeholder={action.adapterId} />
    </label>
  </div>;
}

function ActionButtons({ props, text }: { props: BannerProps; text: BannerText }) {
  const busy = props.actionLoading || props.deleteAdapterLoading;
  const cancel = () => { props.setPendingAction(null); props.setDeleteAdapterConfirmation(''); };
  return <div className="flex flex-wrap gap-2">
    <button onClick={cancel} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900">{text.agent.pendingActions.cancel}</button>
    <button onClick={props.runPendingAction} disabled={busy || !props.deleteConfirmationMatches}
      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? text.agent.pendingActions.working : text.agent.pendingActions.confirm}</button>
  </div>;
}
