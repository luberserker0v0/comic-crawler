import type { BrowserTargetOption } from '../useBrowserTargets';
import { useI18n } from '../../../text/i18n';

interface BrowserTargetSectionProps {
  options: BrowserTargetOption[];
  selectedKey: string;
  setSelectedKey(value: string): void;
  loading: boolean;
  error: string | null;
  refresh(): void;
}

export function BrowserTargetSection(props: BrowserTargetSectionProps) {
  const { text } = useI18n();
  return <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3">
    <div className="flex items-center justify-between gap-3"><div>
      <div className="text-sm font-medium text-blue-950">{text.lab.browserTarget}</div>
      <div className="mt-1 text-xs text-blue-800">{text.lab.browserTargetHelp}</div>
    </div><button type="button" onClick={props.refresh} disabled={props.loading}
      className="rounded border border-blue-300 bg-white px-3 py-1.5 text-xs text-blue-800 disabled:text-gray-400">
      {props.loading ? text.lab.refreshingBrowserTargets : text.lab.refreshBrowserTargets}</button></div>
    <BrowserTargetField props={props} />
  </div>;
}

function BrowserTargetField({ props }: { props: BrowserTargetSectionProps }) {
  const { text } = useI18n();
  if (props.error) return <p className="mt-3 text-xs text-red-700">{props.error}</p>;
  if (!props.options.length) return <p className="mt-3 text-xs text-amber-800">{text.lab.noBrowserTargets}</p>;
  return <select aria-label={text.lab.browserTarget} value={props.selectedKey}
    onChange={(event) => props.setSelectedKey(event.target.value)}
    className="mt-3 block w-full rounded-md border-blue-300 bg-white text-sm shadow-sm">
    {props.options.map((option) => <option key={option.key} value={option.key}>{optionLabel(option, text.lab)}</option>)}
  </select>;
}

function optionLabel(option: BrowserTargetOption, text: ReturnType<typeof useI18n>['text']['lab']): string {
  if (option.kind === 'managed-profile') return `${text.managedProfileTarget}: ${option.workerName}`;
  const page = option.title?.trim() || option.url || text.currentTabTarget;
  return `${text.currentTabTarget}: ${page} — ${option.workerName}`;
}
