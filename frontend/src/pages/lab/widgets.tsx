import type * as React from 'react';
import type {
  AdapterFunctionCapability,
  AdapterImplementationSymbol,
  AdapterResolveResponse,
} from '@comiccrawler/shared';
import { useI18n } from '../../text/i18n';
import { formatText } from '../../text/format';

export const capabilityOrder: AdapterFunctionCapability[] = [
  'common', 'verification', 'metadata', 'readerPreparation', 'chapterImages',
];

export type AdapterChoice = NonNullable<AdapterResolveResponse['adapter']>;

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
  const { text } = useI18n();
  const chapters = getChapterSummaryItems(summary);
  const imageUrls = getImageUrls(summary);
  if (chapters.length > 0) return <ChapterSummary summary={summary} chapters={chapters} text={text} />;
  if (imageUrls.length > 0) return <ImageSummary summary={summary} imageUrls={imageUrls} text={text} />;
  return <RawSummary summary={summary} />;
};

type LabText = ReturnType<typeof useI18n>['text'];

function ChapterSummary({ summary, chapters, text }: { summary: Record<string, unknown>; chapters: ChapterSummaryItem[]; text: LabText }) {
  const count = typeof summary.chapterCount === 'number' ? summary.chapterCount : chapters.length;
  return <div className="mt-3 rounded bg-white p-3 text-xs text-gray-800">
    <div className="text-sm font-semibold text-gray-900">{text.lab.extractedChapters}</div>
    <div className="text-gray-600">{formatText(text.lab.chaptersReturned, { count })}</div>
    <ol className="mt-3 space-y-2">{renderChapterRows(chapters.slice(0, 5))}</ol>
    {chapters.length > 5 && <details className="mt-3"><summary className="cursor-pointer text-blue-700">
      {formatText(text.lab.showAllChapters, { count: chapters.length })}</summary>
      <ol className="mt-3 max-h-96 space-y-2 overflow-auto pr-1">{renderChapterRows(chapters)}</ol></details>}
    <RawDetails summary={summary} text={text} />
  </div>;
}

function ImageSummary({ summary, imageUrls, text }: { summary: Record<string, unknown>; imageUrls: string[]; text: LabText }) {
  const count = typeof summary.imageUrlCount === 'number' ? summary.imageUrlCount : imageUrls.length;
  return <div className="mt-3 rounded bg-white p-3 text-xs text-gray-800">
    <div className="text-sm font-semibold text-gray-900">{text.lab.extractedImageUrls}</div>
    <div className="text-gray-600">{formatText(text.lab.imageUrlsReturned, { count })}</div>
    <ol className="mt-3 max-h-96 space-y-2 overflow-auto pr-1">{imageUrls.map((url, index) =>
      <li key={`${url}-${index}`} className="rounded border border-gray-200 bg-white px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">#{index + 1}</div>
        <div className="mt-1 break-all text-xs text-gray-700">{url}</div></li>)}</ol>
    <RawDetails summary={summary} text={text} />
  </div>;
}

function RawDetails({ summary, text }: { summary: Record<string, unknown>; text: LabText }) {
  return <details className="mt-3"><summary className="cursor-pointer text-gray-600">{text.lab.rawResult}</summary>
    <pre className="mt-2 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs text-gray-800">{JSON.stringify(summary, null, 2)}</pre>
  </details>;
}

function RawSummary({ summary }: { summary: Record<string, unknown> }) {
  return <pre className="mt-3 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-white p-3 text-xs text-gray-800">{JSON.stringify(summary, null, 2)}</pre>;
}
