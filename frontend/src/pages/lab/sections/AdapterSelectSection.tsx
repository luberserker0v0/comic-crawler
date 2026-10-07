import type {
  AdapterCapabilityDetailResponse,
  AdapterDraftSummary,
  AdapterDraftDetailResponse,
  AdapterFunctionCapability,
} from '@comiccrawler/shared';
import {
  capabilityLabels,
  capabilityOrder,
  isCapabilityAllowedForUrlKind,
  urlKindDescription,
  type AdapterChoice,
  type AdapterLabUrlKind,
} from '../widgets';

export function AdapterSelectSection(props: {
  adapterChoices: AdapterChoice[];
  selectedAdapterId: string;
  handleAdapterChange: (adapterId: string) => void;
  draftsForSelectedAdapter: AdapterDraftSummary[];
  draft: AdapterDraftDetailResponse | null;
  openDraft: (draftId: string) => void;
  loading: string | null;
  capabilityDetail: AdapterCapabilityDetailResponse | null;
  urlKind: AdapterLabUrlKind;
  selectedCapability: AdapterFunctionCapability;
  handleCapabilityChange: (capability: AdapterFunctionCapability) => void;
  selectedCapabilityAllowed: boolean;
  functionsForCapability: Array<{ id: string; label: string; capability: AdapterFunctionCapability; implemented: boolean }>;
  selectedFunctionId: string;
  handleFunctionChange: (functionId: string) => void;
}) {
  const {
    adapterChoices,
    selectedAdapterId,
    handleAdapterChange,
    draftsForSelectedAdapter,
    draft,
    openDraft,
    loading,
    capabilityDetail,
    urlKind,
    selectedCapability,
    handleCapabilityChange,
    selectedCapabilityAllowed,
    functionsForCapability,
    selectedFunctionId,
    handleFunctionChange,
  } = props;

  return (
    <section className="space-y-4 rounded-lg bg-white p-5 shadow">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">1. Adapter</h2>
        {adapterChoices.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Resolve a URL to choose an adapter.</p>
        ) : (
          <select
            value={selectedAdapterId}
            onChange={(event) => handleAdapterChange(event.target.value)}
            className="mt-2 block w-full rounded-md border-gray-300 text-sm shadow-sm"
          >
            {adapterChoices.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>
                {adapter.name} ({adapter.id})
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedAdapterId && draftsForSelectedAdapter.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-sm font-semibold text-amber-950">Saved drafts</h3>
          <div className="mt-2 space-y-2">
            {draftsForSelectedAdapter.map((item) => (
              <button
                key={item.draftId}
                type="button"
                onClick={() => void openDraft(item.draftId)}
                disabled={loading === 'draft-open'}
                className={`w-full rounded border px-2 py-2 text-left text-xs ${
                  draft?.draft.draftId === item.draftId
                    ? 'border-amber-500 bg-white text-amber-950'
                    : 'border-amber-200 bg-white/70 text-amber-900 hover:bg-white'
                }`}
              >
                <div className="font-mono">{item.draftId}</div>
                <div className="mt-1 text-amber-700">{item.sourceKind} · updated {new Date(item.updatedAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {capabilityDetail && (
        <>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">2. Capability</h2>
            <p className="mt-1 text-xs text-gray-500">{urlKindDescription(urlKind)}</p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              {capabilityOrder.map((capability) => {
                const implemented = capabilityDetail.functions.some((fn) => fn.capability === capability && fn.implemented);
                const allowed = isCapabilityAllowedForUrlKind(capability, urlKind);
                return (
                  <button
                    key={capability}
                    type="button"
                    onClick={() => handleCapabilityChange(capability)}
                    disabled={!allowed || !implemented}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${
                      selectedCapability === capability
                        ? 'border-blue-500 bg-blue-50'
                        : allowed && implemented
                          ? 'border-gray-200 bg-white hover:bg-gray-50'
                          : 'border-gray-100 bg-gray-50 text-gray-400'
                    }`}
                  >
                    <span className="font-medium">{capabilityLabels[capability]}</span>
                    <span className={implemented ? 'ml-2 text-emerald-700' : 'ml-2 text-rose-700'}>
                      {implemented ? 'O' : 'X'}
                    </span>
                    {!allowed && <div className="mt-1 text-xs text-gray-400">Locked for this URL type</div>}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900">3. Function</h2>
            <div className="mt-2 space-y-2">
              {!selectedCapabilityAllowed && (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                  This capability is locked for the current URL type.
                </div>
              )}
              {functionsForCapability.map((fn) => (
                <button
                  key={fn.id}
                  type="button"
                  onClick={() => handleFunctionChange(fn.id)}
                  disabled={!fn.implemented || !isCapabilityAllowedForUrlKind(fn.capability, urlKind)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    selectedFunctionId === fn.id
                      ? 'border-blue-500 bg-blue-50'
                      : fn.implemented
                        ? 'border-gray-200 bg-white hover:bg-gray-50'
                        : 'border-gray-100 bg-gray-50 text-gray-400'
                  }`}
                >
                  <div className="font-mono text-xs">{fn.label}</div>
                  <div className={fn.implemented ? 'text-emerald-700' : 'text-rose-700'}>
                    {fn.implemented ? 'Implemented' : 'Not implemented'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
