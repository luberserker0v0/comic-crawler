import { describe, it, expect } from '@jest/globals';
import { selectChapters } from '../../../src/crawler/chapter-selection';

const chapters = [
  { id: 'intro', title: '人物介紹', url: 'https://example.com/intro' },
  { id: 'chapter-0', title: '第0章 預告', url: 'https://example.com/chapter-0' },
  { id: 'chapter-1', title: '第1章 出發', url: 'https://example.com/chapter-1' },
  { id: 'chapter-10', title: '第10章 再會', url: 'https://example.com/chapter-10' },
];

describe('selectChapters', () => {
  it('returns all chapters when no selectors are provided', () => {
    expect(selectChapters(chapters).chapters).toEqual(chapters);
    expect(selectChapters(chapters, []).chapters).toEqual(chapters);
  });

  it('matches by chapter id, title, and URL fragments', () => {
    expect(selectChapters(chapters, ['chapter-0']).chapters.map((chapter) => chapter.id)).toEqual(['chapter-0']);
    expect(selectChapters(chapters, ['預告']).chapters.map((chapter) => chapter.id)).toEqual(['chapter-0']);
    expect(selectChapters(chapters, ['chapter-10']).chapters.map((chapter) => chapter.id)).toEqual(['chapter-10']);
  });

  it('supports explicit one-based list indexes with #N', () => {
    expect(selectChapters(chapters, ['#1']).chapters.map((chapter) => chapter.id)).toEqual(['intro']);
    expect(selectChapters(chapters, ['#3']).chapters.map((chapter) => chapter.id)).toEqual(['chapter-1']);
  });

  it('falls back pure numbers to one-based indexes only when text matching fails', () => {
    expect(selectChapters(chapters, ['0']).chapters.map((chapter) => chapter.id)).toEqual(['chapter-0']);
    expect(selectChapters(chapters, ['1']).chapters.map((chapter) => chapter.id)).toEqual(['chapter-1']);
    expect(selectChapters(chapters, ['2']).chapters.map((chapter) => chapter.id)).toEqual(['chapter-0']);
  });

  it('deduplicates matches and reports unmatched selectors', () => {
    const result = selectChapters(chapters, ['chapter-1', '出發', 'missing']);

    expect(result.chapters.map((chapter) => chapter.id)).toEqual(['chapter-1']);
    expect(result.unmatched).toEqual(['missing']);
  });
});
