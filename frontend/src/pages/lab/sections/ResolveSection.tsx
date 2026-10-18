import type { AdapterResolveResponse } from '@comiccrawler/shared';
import { useI18n } from '../../../text/i18n';

export function ResolveSection(props: {
  url: string;
  setUrl: (value: string) => void;
  resolveResult: AdapterResolveResponse | null;
  resolveUrl: () => void;
  loading: string | null;
}) {
  const { url, setUrl, resolveResult, resolveUrl, loading } = props;
  const { text } = useI18n();

  return (
    <section className="rounded-lg bg-white p-5 shadow">
      <label htmlFor="adapter-lab-url" className="block text-sm font-medium text-gray-700">
        {text.lab.websiteUrl}
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
          {loading === 'resolve' ? text.lab.resolving : text.lab.resolve}
        </button>
      </div>
      {resolveResult && (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
          <div>{text.lab.status}: <span className="font-medium">{resolveResult.status}</span></div>
          <div>{text.lab.host}: {resolveResult.hostname}</div>
          <div>{text.lab.required}: {text.agent.capabilityMetadata} {resolveResult.requiredCapabilities.metadata ? 'O' : 'X'} / {text.agent.capabilityChapterImages} {resolveResult.requiredCapabilities.chapterImages ? 'O' : 'X'}</div>
        </div>
      )}
    </section>
  );
}
