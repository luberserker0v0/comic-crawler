import { SUPPORTED_LOCALES, useI18n, type LocaleCode } from '../../../text/i18n';

export function GeneralSettingsSection(props: {
  form: any;
  handleChange: (section: string, key: string, value: any) => void;
  downloadDirectoryMessage: string | null;
  handleBrowseDownloadDirectory: () => void;
  handleOpenDownloadDirectory: () => void;
}) {
  const { text } = useI18n();
  const { form, handleChange, downloadDirectoryMessage, handleBrowseDownloadDirectory, handleOpenDownloadDirectory } = props;

  return (
    <>
      <div className="space-y-4 rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">{text.settings.languageSection}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.languageLabel}</label>
            <select
              value={(form as any).i18n?.language ?? 'zh-TW'}
              onChange={(e) => handleChange('i18n', 'language', e.target.value as LocaleCode)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {text.language[code]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.fallbackLabel}</label>
            <select
              value={(form as any).i18n?.fallback ?? 'en'}
              onChange={(e) => handleChange('i18n', 'fallback', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="en">English</option>
              <option value="zh-TW">繁體中文</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">{text.settings.downloadSection}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.downloadDirectory}</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={(form as any).download?.directory ?? ''}
                onChange={(e) => handleChange('download', 'directory', e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              <button
                type="button"
                onClick={() => void handleBrowseDownloadDirectory()}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Browse
              </button>
              <button
                type="button"
                onClick={() => void handleOpenDownloadDirectory()}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Open
              </button>
            </div>
            {downloadDirectoryMessage && (
              <div className="mt-2 text-xs text-gray-500">{downloadDirectoryMessage}</div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.downloadConcurrency}</label>
            <input
              type="number"
              value={(form as any).download?.concurrency ?? 5}
              onChange={(e) => handleChange('download', 'concurrency', Number(e.target.value))}
              min={1}
              max={20}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.namingTemplate}</label>
            <input
              type="text"
              value={(form as any).download?.namingTemplate ?? ''}
              onChange={(e) => handleChange('download', 'namingTemplate', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.imageFormat}</label>
            <select
              value={(form as any).download?.imageFormat ?? 'original'}
              onChange={(e) => handleChange('download', 'imageFormat', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="original">{text.settings.originalFormat}</option>
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">{text.settings.networkSection}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.timeout}</label>
            <input
              type="number"
              value={(form as any).network?.timeout ?? 30000}
              onChange={(e) => handleChange('network', 'timeout', Number(e.target.value))}
              min={1000}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.retries}</label>
            <input
              type="number"
              value={(form as any).network?.retries ?? 3}
              onChange={(e) => handleChange('network', 'retries', Number(e.target.value))}
              min={0}
              max={10}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{text.settings.retryDelay}</label>
            <input
              type="number"
              value={(form as any).network?.retryDelay ?? 1000}
              onChange={(e) => handleChange('network', 'retryDelay', Number(e.target.value))}
              min={0}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>
        </div>
      </div>
    </>
  );
}
