import type { ComicMetadata } from '@comiccrawler/shared';

export interface ChapterSelectionResult {
  chapters: ComicMetadata['chapters'];
  unmatched: string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeToken(value: string): string {
  return normalize(value).replace(/^chapter\s+/i, 'ch-');
}

function isOneBasedIndexToken(token: string): boolean {
  return /^#\d+$/.test(token);
}

function parseOneBasedIndex(token: string): number | null {
  const raw = token.startsWith('#') ? token.slice(1) : token;
  if (!/^\d+$/.test(raw)) return null;

  const index = Number(raw);
  return Number.isSafeInteger(index) && index > 0 ? index : null;
}

function containsNumberToken(value: string, token: string): boolean {
  if (!/^\d+$/.test(token)) return false;

  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\D)${escaped}(\\D|$)`).test(value);
}

function containsTokenWithNumericBoundary(value: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = /\d$/.test(token) ? '(?!\\d)' : '';
  const prefix = /^\d/.test(token) ? '(?<!\\d)' : '';
  return new RegExp(`${prefix}${escaped}${suffix}`).test(value);
}

function matchesChapter(chapter: ComicMetadata['chapters'][number], token: string): boolean {
  const normalized = normalizeToken(token);
  if (!normalized) return false;

  const id = normalizeToken(chapter.id);
  const title = normalizeToken(chapter.title);
  const url = normalizeToken(chapter.url);

  if (/^\d+$/.test(normalized)) {
    return containsNumberToken(id, normalized) || containsNumberToken(title, normalized) || containsNumberToken(url, normalized);
  }

  if (/\d/.test(normalized)) {
    return (
      id === normalized ||
      title === normalized ||
      url === normalized ||
      containsTokenWithNumericBoundary(id, normalized) ||
      containsTokenWithNumericBoundary(title, normalized) ||
      containsTokenWithNumericBoundary(url, normalized)
    );
  }

  return (
    id === normalized ||
    title === normalized ||
    url === normalized ||
    id.includes(normalized) ||
    title.includes(normalized) ||
    url.includes(normalized)
  );
}

export function selectChapters(
  chapters: ComicMetadata['chapters'],
  selectors?: string[]
): ChapterSelectionResult {
  const requested = selectors?.map((selector) => selector.trim()).filter(Boolean) ?? [];
  if (requested.length === 0) {
    return { chapters, unmatched: [] };
  }

  const selected = new Map<string, ComicMetadata['chapters'][number]>();
  const unmatched: string[] = [];

  for (const token of requested) {
    let matches = chapters.filter((chapter) => matchesChapter(chapter, token));

    const explicitIndex = isOneBasedIndexToken(token) ? parseOneBasedIndex(token) : null;
    if (matches.length === 0 && explicitIndex !== null) {
      const chapter = chapters[explicitIndex - 1];
      matches = chapter ? [chapter] : [];
    }

    const implicitIndex = parseOneBasedIndex(token);
    if (matches.length === 0 && implicitIndex !== null) {
      const chapter = chapters[implicitIndex - 1];
      matches = chapter ? [chapter] : [];
    }

    if (matches.length === 0) {
      unmatched.push(token);
      continue;
    }

    for (const chapter of matches) {
      selected.set(chapter.id, chapter);
    }
  }

  return { chapters: Array.from(selected.values()), unmatched };
}
