import type { AdapterResolveResponse } from '@comiccrawler/shared';

export function ResolveSection(props: {
  url: string;
  setUrl: (value: string) => void;
  resolveResult: AdapterResolveResponse | null;
  resolveUrl: () => void;
  loading: string | null;
}) {
  const { url, setUrl, resolveResult, resolveUrl, loading } = props;

  return (
    <section className="rounded-lg bg-white p-5 shadow">
      <label htmlFor="adapter-lab-url" className="block text-sm font-medium text-gray-700">
        Website or chapter URL
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="adapter-lab-url"
          data-testid="adapter-lab-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://kuronavi.one/manga/example"
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
        <button
          type="button"
          data-testid="adapter-lab-resolve"
          onClick={resolveUrl}
          disabled={!url || loading === 'resolve'}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          {loading === 'resolve' ? 'Resolving...' : 'Resolve'}
        </button>
      </div>
      {resolveResult && (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
          <div>Status: <span className="font-medium">{resolveResult.status}</span></div>
          <div>Host: {resolveResult.hostname}</div>
          <div>Required: Metadata {resolveResult.requiredCapabilities.metadata ? 'O' : 'X'} / Images {resolveResult.requiredCapabilities.chapterImages ? 'O' : 'X'}</div>
        </div>
      )}
    </section>
  );
}
