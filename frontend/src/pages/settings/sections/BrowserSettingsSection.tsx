import { useI18n } from '../../../text/i18n';

export function BrowserSettingsSection(props: {
  form: any;
  handleChange: (section: string, key: string, value: any) => void;
}) {
  const { form, handleChange } = props;
  const { text } = useI18n();

  return (
    <div className="space-y-4 rounded-lg bg-white p-6 shadow" data-testid="browser-crawler-settings">
      <div>
        <h2 className="text-lg font-semibold">{text.settings.browserTitle}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {text.settings.browserDescription}
        </p>
        <p className="mt-1 text-sm text-amber-700">
          {text.settings.browserNoLocal}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">{text.settings.workerWaitTimeout}</label>
          <input
            type="number"
            value={(form as any).browser?.workerWaitTimeoutMs ?? 1800000}
            onChange={(e) => handleChange('browser', 'workerWaitTimeoutMs', Number(e.target.value))}
            min={1000}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">{text.settings.workerWaitTimeoutHelp}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{text.settings.waitUntil}</label>
          <select
            data-testid="browser-wait-until-select"
            value={(form as any).browser?.waitUntil ?? 'domcontentloaded'}
            onChange={(e) => handleChange('browser', 'waitUntil', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            <option value="domcontentloaded">domcontentloaded</option>
            <option value="load">load</option>
            <option value="networkidle">networkidle</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{text.settings.timeout}</label>
          <input
            data-testid="browser-timeout-input"
            type="number"
            value={(form as any).browser?.timeout ?? 30000}
            onChange={(e) => handleChange('browser', 'timeout', Number(e.target.value))}
            min={1000}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{text.settings.maxBrowserInstances}</label>
          <input
            type="number"
            value={(form as any).browser?.maxInstances ?? 2}
            onChange={(e) => handleChange('browser', 'maxInstances', Number(e.target.value))}
            min={1}
            max={10}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{text.settings.waitForSelector}</label>
          <input
            data-testid="browser-wait-selector-input"
            type="text"
            value={(form as any).browser?.waitForSelector ?? ''}
            onChange={(e) => handleChange('browser', 'waitForSelector', e.target.value || undefined)}
            placeholder=".page-chapter img"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{text.settings.postLoadDelay}</label>
          <input
            type="number"
            value={(form as any).browser?.postLoadDelayMs ?? 0}
            onChange={(e) => handleChange('browser', 'postLoadDelayMs', Number(e.target.value))}
            min={0}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{text.settings.challengeWait}</label>
          <input
            data-testid="browser-challenge-wait-input"
            type="number"
            value={(form as any).browser?.challengeWaitMs ?? 15000}
            onChange={(e) => handleChange('browser', 'challengeWaitMs', Number(e.target.value))}
            min={0}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            {text.settings.challengeWaitHelp}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            data-testid="browser-challenge-auto-attempt-input"
            type="checkbox"
            checked={(form as any).browser?.challengeAutoAttempt ?? true}
            onChange={(e) => handleChange('browser', 'challengeAutoAttempt', e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          {text.settings.challengeAutoAttempt}
        </label>
      </div>
    </div>
  );
}
