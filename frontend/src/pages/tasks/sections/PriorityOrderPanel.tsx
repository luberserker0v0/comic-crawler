import { useI18n } from '../../../text/i18n';

export function PriorityOrderPanel(props: {
  priorityOrderDraft: string;
  setPriorityOrderDraft: (value: string) => void;
  priorityOrderMessage: string | null;
  fillPriorityOrderFromVisibleTasks: () => void;
  savePriorityOrder: () => void;
}) {
  const { text } = useI18n();
  return <div className="rounded-2xl bg-white p-6 shadow">
    <PriorityHeader onFill={props.fillPriorityOrderFromVisibleTasks} onSave={props.savePriorityOrder} text={text} />
    <textarea value={props.priorityOrderDraft} onChange={(event) => props.setPriorityOrderDraft(event.target.value)}
      className="mt-4 h-28 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs shadow-sm focus:border-slate-500 focus:ring-slate-500" placeholder="task-..." />
    {props.priorityOrderMessage && <div className="mt-2 text-sm text-slate-600">{props.priorityOrderMessage}</div>}
  </div>;
}

function PriorityHeader({ onFill, onSave, text }: { onFill(): void; onSave(): void; text: ReturnType<typeof useI18n>['text'] }) {
  return <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
    <div><h2 className="text-lg font-semibold text-slate-900">{text.taskManager.forcedOrder}</h2>
      <p className="mt-1 text-sm text-slate-600">{text.taskManager.forcedOrderDescription}</p></div>
    <div className="flex gap-2">
      <button type="button" onClick={onFill} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">{text.taskManager.fillVisible}</button>
      <button type="button" onClick={() => void onSave()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">{text.taskManager.saveOrder}</button>
    </div>
  </div>;
}
