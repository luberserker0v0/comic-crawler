export function PriorityOrderPanel(props: {
  priorityOrderDraft: string;
  setPriorityOrderDraft: (value: string) => void;
  priorityOrderMessage: string | null;
  fillPriorityOrderFromVisibleTasks: () => void;
  savePriorityOrder: () => void;
}) {
  const {
    priorityOrderDraft,
    setPriorityOrderDraft,
    priorityOrderMessage,
    fillPriorityOrderFromVisibleTasks,
    savePriorityOrder,
  } = props;

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Forced task order</h2>
          <p className="mt-1 text-sm text-slate-600">
            One task id per line. Pending tasks listed here run in this exact order before tasks outside the list.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fillPriorityOrderFromVisibleTasks}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Fill visible
          </button>
          <button
            type="button"
            onClick={() => void savePriorityOrder()}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Save order
          </button>
        </div>
      </div>
      <textarea
        value={priorityOrderDraft}
        onChange={(event) => setPriorityOrderDraft(event.target.value)}
        className="mt-4 h-28 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs shadow-sm focus:border-slate-500 focus:ring-slate-500"
        placeholder="task-..."
      />
      {priorityOrderMessage && (
        <div className="mt-2 text-sm text-slate-600">{priorityOrderMessage}</div>
      )}
    </div>
  );
}
