import { useI18n } from '../../../text/i18n';
import type { DeletedAdapterListItem } from '@comiccrawler/shared';
import { formatDateTime, formatImplementationKind } from '../widgets';

export function DeletedAdaptersSection(props: {
  deletedAdapters: DeletedAdapterListItem[];
  deletedAdaptersLoading: boolean;
  deletedAdaptersError: string | null;
  restoringAdapterId: string | null;
  fetchDeletedAdapters: () => Promise<void>;
  restoreDeletedAdapter: (adapterId: string) => Promise<void>;
}) {
  const { text } = useI18n();
  const {
    deletedAdapters,
    deletedAdaptersLoading,
    deletedAdaptersError,
    restoringAdapterId,
    fetchDeletedAdapters,
    restoreDeletedAdapter,
  } = props;

  return (
    <section className="rounded-2xl bg-white p-6 shadow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{text.agent.deletedAdapters}</h2>
          <p className="mt-1 text-sm text-slate-500">{text.agent.deletedAdaptersDescription}</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchDeletedAdapters()}
          disabled={deletedAdaptersLoading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deletedAdaptersLoading ? `${text.agent.refresh}...` : text.agent.refresh}
        </button>
      </div>

      {deletedAdaptersError && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{deletedAdaptersError}</div>
      )}

      <div className="mt-5 space-y-3">
        {deletedAdapters.map((adapter) => (
          <div key={`${adapter.adapterId}-${adapter.deletedAt}`} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">{adapter.adapterId}</div>
                <div className="mt-1 text-xs text-slate-500">{text.agent.deletedAt}: {formatDateTime(adapter.deletedAt)}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                    {formatImplementationKind(text, adapter.implementationKind)}
                  </span>
                  <span className={`rounded-full px-2 py-1 ${adapter.restorable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {adapter.restorable ? text.agent.restorable : text.agent.notRestorable}
                  </span>
                </div>
                {adapter.sourcePath && (
                  <div className="mt-3 break-all text-xs text-slate-600">
                    {text.agent.sourcePath}: <span className="font-mono">{adapter.sourcePath}</span>
                  </div>
                )}
                {adapter.sourceDirectory && (
                  <div className="mt-1 break-all text-xs text-slate-500">
                    {text.agent.sourceDirectory}: <span className="font-mono">{adapter.sourceDirectory}</span>
                  </div>
                )}
                <div className="mt-3 text-sm text-slate-600">{adapter.restoreReason}</div>
              </div>
              <button
                type="button"
                onClick={() => void restoreDeletedAdapter(adapter.adapterId)}
                disabled={!adapter.restorable || restoringAdapterId === adapter.adapterId}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {restoringAdapterId === adapter.adapterId ? `${text.agent.restoreAdapter}...` : text.agent.restoreAdapter}
              </button>
            </div>
          </div>
        ))}
        {deletedAdapters.length === 0 && !deletedAdaptersLoading && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            {text.agent.noDeletedAdapters}
          </div>
        )}
      </div>
    </section>
  );
}
