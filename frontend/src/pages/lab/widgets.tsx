import type * as React from 'react';
import type {
  AdapterFunctionCapability,
  AdapterImplementationSymbol,
  AdapterResolveResponse,
} from '@comiccrawler/shared';

export const capabilityLabels: Record<AdapterFunctionCapability, string> = {
  common: 'Common',
  verification: 'Verification handoff',
  metadata: 'Manga metadata',
  chapterImages: 'Chapter images',
};

export const capabilityOrder: AdapterFunctionCapability[] = ['common', 'verification', 'metadata', 'chapterImages'];

export type AdapterChoice = NonNullable<AdapterResolveResponse['adapter']>;
export type AdapterLabUrlKind = 'manga' | 'chapter' | 'unknown';

export function getUrlKind(value: string): AdapterLabUrlKind {
  try {
    const pathname = new URL(value).pathname;
    if (/\/mangaread\//i.test(pathname)) return 'chapter';
    if (/\/manga\//i.test(pathname)) return 'manga';
  } catch {
    // Treat unparseable input as unknown until resolve validates it.
  }
  return 'unknown';
}

export function isCapabilityAllowedForUrlKind(capability: AdapterFunctionCapability, kind: AdapterLabUrlKind): boolean {
  if (capability === 'common' || capability === 'verification') return true;
  if (capability === 'metadata') return kind === 'manga';
  if (capability === 'chapterImages') return kind === 'chapter';
  return false;
}

export function urlKindDescription(kind: AdapterLabUrlKind): string {
  if (kind === 'manga') return 'This URL looks like a manga catalog page. Metadata functions are available; chapter image functions require a chapter URL.';
  if (kind === 'chapter') return 'This URL looks like a chapter page. Chapter image functions are available; metadata functions require a manga catalog URL.';
  return 'Enter a manga catalog URL or chapter URL to unlock matching adapter functions.';
}

export function formatLineRange(symbol: AdapterImplementationSymbol): string {
  if (!symbol.startLine) return '';
  if (!symbol.endLine || symbol.endLine === symbol.startLine) return `L${symbol.startLine}`;
  return `L${symbol.startLine}-L${symbol.endLine}`;
}

export interface ChapterSummaryItem {
  id?: string;
  title?: string;
  url?: string;
  number?: number;
}

export function isChapterSummaryItem(value: unknown): value is ChapterSummaryItem {
  return typeof value === 'object' && value !== null && (
    'title' in value || 'url' in value || 'id' in value || 'number' in value
  );
}

export function getChapterSummaryItems(summary: Record<string, unknown> | undefined): ChapterSummaryItem[] {
  if (!summary || !Array.isArray(summary.chapters)) return [];
  return summary.chapters.filter(isChapterSummaryItem);
}

export function getImageUrls(summary: Record<string, unknown> | undefined): string[] {
  if (!summary || !Array.isArray(summary.imageUrls)) return [];
  return summary.imageUrls.filter((value): value is string => typeof value === 'string');
}

export function renderChapterRows(chapters: ChapterSummaryItem[]) {
  return chapters.map((chapter, index) => (
    <li key={`${chapter.id ?? chapter.url ?? index}`} className="rounded border border-gray-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-gray-900">
          {chapter.title || chapter.id || `Chapter ${index + 1}`}
        </span>
        {typeof chapter.number === 'number' && (
          <span className="text-[11px] uppercase tracking-wide text-gray-500">#{chapter.number}</span>
        )}
      </div>
      {chapter.url && (
        <div className="mt-1 break-all text-xs text-gray-600">{chapter.url}</div>
      )}
    </li>
  ));
}

export const AdapterFunctionResultSummary: React.FC<{ summary: Record<string, unknown> }> = ({ summary }) => {
  const chapters = getChapterSummaryItems(summary);
  const imageUrls = getImageUrls(summary);
  if (chapters.length > 0) {
    const chapterCount = typeof summary.chapterCount === 'number' ? summary.chapterCount : chapters.length;
    return (
      <div className="mt-3 rounded bg-white p-3 text-xs text-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">Extracted chapters</div>
            <div className="text-gray-600">{chapterCount} chapters returned by the adapter function.</div>
          </div>
        </div>
        <ol className="mt-3 space-y-2">{renderChapterRows(chapters.slice(0, 5))}</ol>
        {chapters.length > 5 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-blue-700">
              Show all {chapters.length} chapters
            </summary>
            <ol className="mt-3 max-h-96 space-y-2 overflow-auto pr-1">
              {renderChapterRows(chapters)}
            </ol>
          </details>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-gray-600">Raw result JSON</summary>
          <pre className="mt-2 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs text-gray-800">
            {JSON.stringify(summary, null, 2)}
          </pre>
        </details>
      </div>
    );
  }

  if (imageUrls.length > 0) {
    const imageUrlCount = typeof summary.imageUrlCount === 'number' ? summary.imageUrlCount : imageUrls.length;
    return (
      <div className="mt-3 rounded bg-white p-3 text-xs text-gray-800">
        <div className="text-sm font-semibold text-gray-900">Extracted image URLs</div>
        <div className="text-gray-600">{imageUrlCount} image URLs returned by the adapter function.</div>
        <ol className="mt-3 max-h-96 space-y-2 overflow-auto pr-1">
          {imageUrls.map((url, index) => (
            <li key={`${url}-${index}`} className="rounded border border-gray-200 bg-white px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">#{index + 1}</div>
              <div className="mt-1 break-all text-xs text-gray-700">{url}</div>
            </li>
          ))}
        </ol>
        <details className="mt-3">
          <summary className="cursor-pointer text-gray-600">Raw result JSON</summary>
          <pre className="mt-2 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs text-gray-800">
            {JSON.stringify(summary, null, 2)}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <pre className="mt-3 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-white p-3 text-xs text-gray-800">
      {JSON.stringify(summary, null, 2)}
    </pre>
  );
};
