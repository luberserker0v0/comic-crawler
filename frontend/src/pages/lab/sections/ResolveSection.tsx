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
  return <section className="rounded-lg bg-white p-5 shadow">
    <label htmlFor="adapter-lab-url" className="block text-sm font-medium text-gray-700">{text.lab.websiteUrl}</label>
    <ResolveControls url={url} setUrl={setUrl} resolveUrl={resolveUrl} loading={loading} text={text} />
    {resolveResult && <ResolveResult result={resolveResult} text={text} />}
  </section>;
}

type ResolveText = ReturnType<typeof useI18n>['text'];

function ResolveControls(props: Pick<Parameters<typeof ResolveSection>[0], 'url' | 'setUrl' | 'resolveUrl' | 'loading'> & { text: ResolveText }) {
  return <div className="mt-2 flex gap-2">
    <input id="adapter-lab-url" data-testid="adapter-lab-url" value={props.url}
      onChange={(event) => props.setUrl(event.target.value)} placeholder="https://kuronavi.one/manga/example"
      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
    <button type="button" data-testid="adapter-lab-resolve" onClick={props.resolveUrl}
      disabled={!props.url || props.loading === 'resolve'}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300">
      {props.loading === 'resolve' ? props.text.lab.resolving : props.text.lab.resolve}
    </button>
  </div>;
}

function ResolveResult({ result, text }: { result: AdapterResolveResponse; text: ResolveText }) {
  return <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
    <div>{text.lab.status}: <span className="font-medium">{result.status}</span></div>
    <div>{text.lab.host}: {result.hostname}</div>
    <div>{text.lab.required}: {text.agent.capabilityMetadata} {result.requiredCapabilities.metadata ? 'O' : 'X'} / {text.agent.capabilityChapterImages} {result.requiredCapabilities.chapterImages ? 'O' : 'X'}</div>
  </div>;
}
