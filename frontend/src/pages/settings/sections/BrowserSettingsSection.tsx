export function BrowserSettingsSection(props: {
  form: any;
  handleChange: (section: string, key: string, value: any) => void;
  handleNestedChange: (section: string, nested: string, key: string, value: any) => void;
  cdpTestMessage: string | null;
  handleCdpTest: () => void;
}) {
  const { form, handleChange, handleNestedChange, cdpTestMessage, handleCdpTest } = props;

  return (
    <div className="space-y-4 rounded-lg bg-white p-6 shadow" data-testid="browser-crawler-settings">
      <div>
        <h2 className="text-lg font-semibold">Headless Browser Crawler</h2>
        <p className="mt-1 text-sm text-slate-500">
          Static uses direct HTTP. Headless renders pages with Playwright. Auto tries static first and falls back to headless on parsing failures.
        </p>
        <p className="mt-1 text-sm text-amber-700">
          For Cloudflare challenge pages, solve the challenge manually in a browser you control, then point ComicCrawler at a Playwright storage state file or persistent browser profile. ComicCrawler will not generate selectors from challenge pages.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Crawler mode</label>
          <select
            data-testid="browser-mode-select"
            value={(form as any).browser?.mode ?? 'auto'}
            onChange={(e) => handleChange('browser', 'mode', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            <option value="auto">auto</option>
            <option value="static">static</option>
            <option value="headless">headless</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Wait until</label>
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
          <label className="block text-sm font-medium text-gray-700">Timeout (ms)</label>
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
          <label className="block text-sm font-medium text-gray-700">Max browser instances</label>
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
          <label className="block text-sm font-medium text-gray-700">Wait for selector</label>
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
          <label className="block text-sm font-medium text-gray-700">Post-load delay (ms)</label>
          <input
            type="number"
            value={(form as any).browser?.postLoadDelayMs ?? 0}
            onChange={(e) => handleChange('browser', 'postLoadDelayMs', Number(e.target.value))}
            min={0}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Challenge wait (ms)</label>
          <input
            data-testid="browser-challenge-wait-input"
            type="number"
            value={(form as any).browser?.challengeWaitMs ?? 15000}
            onChange={(e) => handleChange('browser', 'challengeWaitMs', Number(e.target.value))}
            min={0}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            If a JavaScript challenge appears, Playwright waits this long for it to complete naturally before marking the page blocked.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={(form as any).browser?.headless ?? true}
            onChange={(e) => handleChange('browser', 'headless', e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Run browser headless
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            data-testid="browser-challenge-auto-attempt-input"
            type="checkbox"
            checked={(form as any).browser?.challengeAutoAttempt ?? true}
            onChange={(e) => handleChange('browser', 'challengeAutoAttempt', e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Attempt JavaScript challenge automatically
        </label>
        <div>
          <label className="block text-sm font-medium text-gray-700">Browser channel</label>
          <input
            data-testid="browser-channel-input"
            type="text"
            value={(form as any).browser?.channel ?? ''}
            onChange={(e) => handleChange('browser', 'channel', e.target.value || undefined)}
            placeholder="chrome or msedge"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-sm font-medium text-gray-700">Storage state path</label>
          <input
            data-testid="browser-storage-state-input"
            type="text"
            value={(form as any).browser?.storageStatePath ?? ''}
            onChange={(e) => handleChange('browser', 'storageStatePath', e.target.value || undefined)}
            placeholder="D:\\path\\to\\storage-state.json"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            Use a Playwright storageState JSON exported after you manually pass a site challenge.
          </p>
        </div>
        <div className="md:col-span-3">
          <label className="block text-sm font-medium text-gray-700">Persistent user data directory</label>
          <input
            data-testid="browser-user-data-dir-input"
            type="text"
            value={(form as any).browser?.userDataDir ?? ''}
            onChange={(e) => handleChange('browser', 'userDataDir', e.target.value || undefined)}
            placeholder="D:\\path\\to\\comiccrawler-browser-profile"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            When set, Playwright uses a persistent browser profile and limits the browser pool to one instance for that profile.
          </p>
        </div>
        <div className="md:col-span-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="font-medium text-slate-800">Challenge handoff</div>
          <p className="mt-1 text-xs text-slate-500">
            Prefer HTML snapshot for safety. CDP attach reads DOM from a user-launched local browser; only localhost CDP endpoints are accepted.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Handoff mode</label>
              <select
                data-testid="browser-handoff-mode-input"
                value={(form as any).browser?.handoff?.mode ?? 'snapshot'}
                onChange={(e) => handleNestedChange('browser', 'handoff', 'mode', e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="snapshot">HTML snapshot</option>
                <option value="cdp">Attach via CDP</option>
                <option value="managed">Managed browser</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">CDP URL</label>
              <input
                data-testid="browser-handoff-cdp-url-input"
                type="text"
                value={(form as any).browser?.handoff?.cdpUrl ?? ''}
                onChange={(e) => handleNestedChange('browser', 'handoff', 'cdpUrl', e.target.value || undefined)}
                placeholder="http://127.0.0.1:9222"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCdpTest}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100"
            >
              Test CDP connection
            </button>
            {cdpTestMessage && <span className="text-sm text-slate-600">{cdpTestMessage}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
