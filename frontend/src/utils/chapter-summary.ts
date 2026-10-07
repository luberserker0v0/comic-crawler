import type { ChapterListSummary } from '../store';

export function parseChapterListSummary(value: unknown): ChapterListSummary | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters
        .map((chapter) => {
          if (!chapter || typeof chapter !== 'object') return null;
          const item = chapter as Record<string, unknown>;
          return {
            id: typeof item.id === 'string' ? item.id : '',
            title: typeof item.title === 'string' ? item.title : '',
            url: typeof item.url === 'string' ? item.url : '',
          };
        })
        .filter((chapter): chapter is { id: string; title: string; url: string } => Boolean(chapter && chapter.url))
    : [];
  return {
    totalChapters: typeof raw.totalChapters === 'number' ? raw.totalChapters : chapters.length,
    chapters,
  };
}
