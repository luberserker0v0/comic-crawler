import { useI18n } from '../../../text/i18n';

export function BrowserSettingsSection(props: {
  form: any;
  handleChange: (section: string, key: string, value: any) => void;
}) {
  const { form, handleChange } = props;
  const { text } = useI18n();
  const fields = browserFields(text, form);
  return <div className="space-y-4 rounded-lg bg-white p-6 shadow" data-testid="browser-crawler-settings">
    <BrowserSettingsHeader text={text} />
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {fields.map(({ key, ...field }) => <BrowserNumberField key={key} fieldKey={key} {...field} handleChange={handleChange} />)}
    </div>
  </div>;
}

type BrowserText = ReturnType<typeof useI18n>['text'];

function BrowserSettingsHeader({ text }: { text: BrowserText }) {
  return <div>
    <h2 className="text-lg font-semibold">{text.settings.browserTitle}</h2>
    <p className="mt-1 text-sm text-slate-500">{text.settings.browserDescription}</p>
    <p className="mt-1 text-sm text-amber-700">{text.settings.browserNoLocal}</p>
  </div>;
}

function browserFields(text: BrowserText, form: any) {
  return [
    { key: 'workerWaitTimeoutMs', label: text.settings.workerWaitTimeout, value: form.browser?.workerWaitTimeoutMs ?? 1800000,
      min: 1000, testId: 'browser-worker-wait-timeout-input', help: text.settings.workerWaitTimeoutHelp },
    { key: 'timeout', label: text.settings.timeout, value: form.browser?.timeout ?? 30000,
      min: 1000, testId: 'browser-timeout-input' },
    { key: 'postLoadDelayMs', label: text.settings.postLoadDelay, value: form.browser?.postLoadDelayMs ?? 0,
      min: 0, testId: 'browser-post-load-delay-input' },
  ];
}

function BrowserNumberField(props: Omit<ReturnType<typeof browserFields>[number], 'key'> & { fieldKey: string; handleChange: BrowserSettingsSectionProps['handleChange'] }) {
  return <div>
    <label className="block text-sm font-medium text-gray-700">{props.label}</label>
    <input data-testid={props.testId} type="number" value={props.value} min={props.min}
      onChange={(event) => props.handleChange('browser', props.fieldKey, Number(event.target.value))}
      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm" />
    {props.help && <p className="mt-1 text-xs text-slate-500">{props.help}</p>}
  </div>;
}

type BrowserSettingsSectionProps = Parameters<typeof BrowserSettingsSection>[0];
