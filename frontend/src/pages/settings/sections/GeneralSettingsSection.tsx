import { SUPPORTED_LOCALES, useI18n, type LocaleCode } from '../../../text/i18n';

export function GeneralSettingsSection(props: {
  form: any;
  handleChange: (section: string, key: string, value: any) => void;
  downloadDirectoryMessage: string | null;
  handleBrowseDownloadDirectory: () => void;
  handleOpenDownloadDirectory: () => void;
}) {
  const { text } = useI18n();
  return <>
    <LanguageSettings form={props.form} handleChange={props.handleChange} text={text} />
    <DownloadSettings {...props} text={text} />
    <NetworkSettings form={props.form} handleChange={props.handleChange} text={text} />
  </>;
}

type GeneralProps = Parameters<typeof GeneralSettingsSection>[0];
type GeneralText = ReturnType<typeof useI18n>['text'];
const inputClass = 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm';

function LanguageSettings({ form, handleChange, text }: Pick<GeneralProps, 'form' | 'handleChange'> & { text: GeneralText }) {
  return <SettingsCard title={text.settings.languageSection} columns="md:grid-cols-2">
    <SelectField label={text.settings.languageLabel} value={form.i18n?.language ?? 'zh-TW'}
      onChange={(value) => handleChange('i18n', 'language', value as LocaleCode)}>
      {SUPPORTED_LOCALES.map((code) => <option key={code} value={code}>{text.language[code]}</option>)}
    </SelectField>
    <SelectField label={text.settings.fallbackLabel} value={form.i18n?.fallback ?? 'en'}
      onChange={(value) => handleChange('i18n', 'fallback', value)}>
      <option value="en">{text.language['en-US']}</option><option value="zh-TW">{text.language['zh-TW']}</option>
    </SelectField>
  </SettingsCard>;
}

function DownloadSettings(props: GeneralProps & { text: GeneralText }) {
  const { form, handleChange, text } = props;
  return <SettingsCard title={text.settings.downloadSection} columns="md:grid-cols-2">
    <DownloadDirectory {...props} />
    <NumberField label={text.settings.downloadConcurrency} value={form.download?.concurrency ?? 5}
      onChange={(value) => handleChange('download', 'concurrency', value)} min={1} max={20} />
    <TextField label={text.settings.namingTemplate} value={form.download?.namingTemplate ?? ''}
      onChange={(value) => handleChange('download', 'namingTemplate', value)} />
    <SelectField label={text.settings.imageFormat} value={form.download?.imageFormat ?? 'original'}
      onChange={(value) => handleChange('download', 'imageFormat', value)}>
      <option value="original">{text.settings.originalFormat}</option><option value="jpg">JPG</option>
      <option value="png">PNG</option><option value="webp">WebP</option>
    </SelectField>
  </SettingsCard>;
}

function DownloadDirectory(props: GeneralProps & { text: GeneralText }) {
  return <div><label className="block text-sm font-medium text-gray-700">{props.text.settings.downloadDirectory}</label>
    <div className="mt-1 flex gap-2">
      <input type="text" value={props.form.download?.directory ?? ''}
        onChange={(event) => props.handleChange('download', 'directory', event.target.value)} className={inputClass} />
      <ActionButton onClick={props.handleBrowseDownloadDirectory}>{props.text.settings.browse}</ActionButton>
      <ActionButton onClick={props.handleOpenDownloadDirectory}>{props.text.settings.open}</ActionButton>
    </div>
    {props.downloadDirectoryMessage && <div className="mt-2 text-xs text-gray-500">{props.downloadDirectoryMessage}</div>}
  </div>;
}

function NetworkSettings({ form, handleChange, text }: Pick<GeneralProps, 'form' | 'handleChange'> & { text: GeneralText }) {
  const fields = [
    ['timeout', text.settings.timeout, form.network?.timeout ?? 30000, 1000, undefined],
    ['retries', text.settings.retries, form.network?.retries ?? 3, 0, 10],
    ['retryDelay', text.settings.retryDelay, form.network?.retryDelay ?? 1000, 0, undefined],
  ] as const;
  return <SettingsCard title={text.settings.networkSection} columns="md:grid-cols-3">
    {fields.map(([key, label, value, min, max]) => <NumberField key={key} label={label} value={value} min={min} max={max}
      onChange={(next) => handleChange('network', key, next)} />)}
  </SettingsCard>;
}

function SettingsCard({ title, columns, children }: { title: string; columns: string; children: React.ReactNode }) {
  return <div className="space-y-4 rounded-lg bg-white p-6 shadow"><h2 className="text-lg font-semibold">{title}</h2>
    <div className={`grid grid-cols-1 gap-4 ${columns}`}>{children}</div></div>;
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange(value: string): void; children: React.ReactNode }) {
  return <div><label className="block text-sm font-medium text-gray-700">{label}</label>
    <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>{children}</select></div>;
}

function NumberField(props: { label: string; value: number; min: number; max?: number; onChange(value: number): void }) {
  return <div><label className="block text-sm font-medium text-gray-700">{props.label}</label>
    <input type="number" value={props.value} min={props.min} max={props.max}
      onChange={(event) => props.onChange(Number(event.target.value))} className={inputClass} /></div>;
}

function TextField(props: { label: string; value: string; onChange(value: string): void }) {
  return <div><label className="block text-sm font-medium text-gray-700">{props.label}</label>
    <input type="text" value={props.value} onChange={(event) => props.onChange(event.target.value)} className={inputClass} /></div>;
}

function ActionButton({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return <button type="button" onClick={() => void onClick()}
    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">{children}</button>;
}
