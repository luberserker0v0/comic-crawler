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
  const values = [chapter.id, chapter.title, chapter.url].map(normalizeToken);
  if (/^\d+$/.test(normalized)) {
    return values.some((value) => containsNumberToken(value, normalized));
  }
  if (/\d/.test(normalized)) {
    return values.some((value) => value === normalized || containsTokenWithNumericBoundary(value, normalized));
  }
  return values.some((value) => value === normalized || value.includes(normalized));
}

export function selectChapters(
  chapters: ComicMetadata['chapters'],
  selectors?: string[]
): ChapterSelectionResult {
  const requested = selectors?.map((selector) => selector.trim()).filter(Boolean) ?? [];
  if (requested.length === 0) return { chapters, unmatched: [] };
  const selected = new Map<string, ComicMetadata['chapters'][number]>();
  const unmatched: string[] = [];
  for (const token of requested) {
    const matches = findChapterMatches(chapters, token);
    if (matches.length === 0) unmatched.push(token);
    else for (const chapter of matches) selected.set(chapter.id, chapter);
  }
  return { chapters: Array.from(selected.values()), unmatched };
}

function findChapterMatches(chapters: ComicMetadata['chapters'], token: string): ComicMetadata['chapters'] {
  const matches = chapters.filter((chapter) => matchesChapter(chapter, token));
  if (matches.length > 0) return matches;
  const explicit = isOneBasedIndexToken(token) ? parseOneBasedIndex(token) : null;
  const index = explicit ?? parseOneBasedIndex(token);
  const chapter = index === null ? undefined : chapters[index - 1];
  return chapter ? [chapter] : [];
}
