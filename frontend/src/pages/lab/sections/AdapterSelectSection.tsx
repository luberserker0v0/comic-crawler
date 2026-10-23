import type {
  AdapterCapabilityDetailResponse,
  AdapterDraftSummary,
  AdapterDraftDetailResponse,
  AdapterFunctionCapability,
} from '@comiccrawler/shared';
import {
  capabilityOrder,
  type AdapterChoice,
} from '../widgets';
import { useI18n } from '../../../text/i18n';

interface AdapterSelectProps {
  adapterChoices: AdapterChoice[];
  selectedAdapterId: string;
  handleAdapterChange: (adapterId: string) => void;
  draftsForSelectedAdapter: AdapterDraftSummary[];
  draft: AdapterDraftDetailResponse | null;
  openDraft: (draftId: string) => void;
  loading: string | null;
  capabilityDetail: AdapterCapabilityDetailResponse | null;
  selectedCapability: AdapterFunctionCapability;
  handleCapabilityChange: (capability: AdapterFunctionCapability) => void;
  functionsForCapability: Array<{ id: string; label: string; capability: AdapterFunctionCapability; implemented: boolean }>;
  selectedFunctionId: string;
  handleFunctionChange: (functionId: string) => void;
}

export function AdapterSelectSection(props: AdapterSelectProps) {
  const { text } = useI18n();
  const labels = capabilityLabels(text);
  return <section className="space-y-4 rounded-lg bg-white p-5 shadow">
    <AdapterChoiceField props={props} text={text} />
    <SavedDrafts props={props} text={text} />
    {props.capabilityDetail && <><CapabilityChoices props={props} text={text} labels={labels} />
      <FunctionChoices props={props} text={text} /></>}
  </section>;
}

type SelectText = ReturnType<typeof useI18n>['text'];

function capabilityLabels(text: SelectText): Record<AdapterFunctionCapability, string> {
  return {
    common: text.lab.commonCapability,
    verification: text.agent.capabilityVerification,
    metadata: text.agent.capabilityMetadata,
    chapterImages: text.agent.capabilityChapterImages,
  };
}

function AdapterChoiceField({ props, text }: { props: AdapterSelectProps; text: SelectText }) {
  return <div><h2 className="text-lg font-semibold text-gray-900">{text.lab.adapterStep}</h2>
    {props.adapterChoices.length === 0 ? <p className="mt-2 text-sm text-gray-500">{text.lab.resolveToChoose}</p>
      : <select value={props.selectedAdapterId} onChange={(event) => props.handleAdapterChange(event.target.value)}
        className="mt-2 block w-full rounded-md border-gray-300 text-sm shadow-sm">
        {props.adapterChoices.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.name} ({adapter.id})</option>)}
      </select>}
  </div>;
}

function SavedDrafts({ props, text }: { props: AdapterSelectProps; text: SelectText }) {
  if (!props.selectedAdapterId || props.draftsForSelectedAdapter.length === 0) return null;
  return <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
    <h3 className="text-sm font-semibold text-amber-950">{text.lab.savedDrafts}</h3>
    <div className="mt-2 space-y-2">{props.draftsForSelectedAdapter.map((item) => {
      const active = props.draft?.draft.draftId === item.draftId;
      return <button key={item.draftId} type="button" onClick={() => void props.openDraft(item.draftId)}
        disabled={props.loading === 'draft-open'} className={`w-full rounded border px-2 py-2 text-left text-xs ${active ? 'border-amber-500 bg-white text-amber-950' : 'border-amber-200 bg-white/70 text-amber-900 hover:bg-white'}`}>
        <div className="font-mono">{item.draftId}</div><div className="mt-1 text-amber-700">{item.sourceKind} · {text.lab.updated} {new Date(item.updatedAt).toLocaleString()}</div>
      </button>;
    })}</div>
  </div>;
}

function CapabilityChoices({ props, text, labels }: { props: AdapterSelectProps; text: SelectText;
  labels: Record<AdapterFunctionCapability, string> }) {
  return <div><h2 className="text-lg font-semibold text-gray-900">{text.lab.capabilityStep}</h2>
    <p className="mt-1 text-xs text-gray-500">{text.lab.capabilityInputHelp}</p>
    <div className="mt-2 grid grid-cols-1 gap-2">{capabilityOrder.map((capability) =>
      <CapabilityButton key={capability} capability={capability} props={props} label={labels[capability]} />)}</div>
  </div>;
}

function CapabilityButton({ capability, props, label }: { capability: AdapterFunctionCapability;
  props: AdapterSelectProps; label: string }) {
  const implemented = props.capabilityDetail!.functions.some((fn) => fn.capability === capability && fn.implemented);
  const color = props.selectedCapability === capability ? 'border-blue-500 bg-blue-50'
    : implemented ? 'border-gray-200 bg-white hover:bg-gray-50' : 'border-gray-100 bg-gray-50 text-gray-400';
  return <button type="button" onClick={() => props.handleCapabilityChange(capability)} disabled={!implemented}
    className={`rounded-md border px-3 py-2 text-left text-sm ${color}`}><span className="font-medium">{label}</span>
    <span className={implemented ? 'ml-2 text-emerald-700' : 'ml-2 text-rose-700'}>{implemented ? 'O' : 'X'}</span>
  </button>;
}

function FunctionChoices({ props, text }: { props: AdapterSelectProps; text: SelectText }) {
  return <div><h2 className="text-lg font-semibold text-gray-900">{text.lab.functionStep}</h2>
    <div className="mt-2 space-y-2">{props.functionsForCapability.map((fn) =>
      <FunctionButton key={fn.id} fn={fn} props={props} text={text} />)}</div>
  </div>;
}

function FunctionButton({ fn, props, text }: { fn: AdapterSelectProps['functionsForCapability'][number]; props: AdapterSelectProps; text: SelectText }) {
  const selected = props.selectedFunctionId === fn.id;
  const color = selected ? 'border-blue-500 bg-blue-50' : fn.implemented
    ? 'border-gray-200 bg-white hover:bg-gray-50' : 'border-gray-100 bg-gray-50 text-gray-400';
  return <button type="button" onClick={() => props.handleFunctionChange(fn.id)}
    disabled={!fn.implemented}
    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${color}`}>
    <div className="font-mono text-xs">{fn.label}</div><div className={fn.implemented ? 'text-emerald-700' : 'text-rose-700'}>
      {fn.implemented ? text.lab.implemented : text.lab.notImplemented}</div>
  </button>;
}
