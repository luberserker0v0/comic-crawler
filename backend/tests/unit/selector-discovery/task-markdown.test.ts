import { describe, expect, it } from '@jest/globals';
import {
  createChapterOnlyTaskMarkdown,
  extractFallbackChapterUrlFromHtml,
  extractRepresentativeChapterUrl,
} from '../../../src/selector-discovery/task-markdown';

describe('selector discovery task Markdown', () => {
  it('creates a chapter-only prompt focused on image extraction', () => {
    const markdown = createChapterOnlyTaskMarkdown({
      url: 'https://example.com/manga/demo/chapter-1',
      chapterFetch: {
        url: 'https://example.com/manga/demo/chapter-1',
        finalUrl: 'https://example.com/manga/demo/chapter-1',
        redirectChain: [],
        contentType: 'text/html',
        html: '<html><body><main class="reader"><img data-src="/001.jpg"></main></body></html>',
      },
    });

    expect(markdown).toContain('chapter-only adapter');
    expect(markdown).toContain('Metadata selectors are not required.');
    expect(markdown).toContain('Image selectors are required.');
    expect(markdown).not.toContain('Choose one representative chapter URL');
  });

  it('extracts representative chapter URLs and strips ASCII trailing punctuation', () => {
    expect(extractRepresentativeChapterUrl(
      '## Representative Chapter URL\n\nhttps://example.com/manga/demo/chapter-1).',
      'https://example.com/manga/demo'
    )).toBe('https://example.com/manga/demo/chapter-1');
  });

  it('finds fallback chapter links from common reader URL signals', () => {
    const html = `
      <a href="/about">About</a>
      <a href="/manga/demo/chapter-1">Read chapter 1</a>
      <a href="/viewer/demo/2">Viewer</a>
    `;

    expect(extractFallbackChapterUrlFromHtml(html, 'https://example.com/manga/demo'))
      .toBe('https://example.com/manga/demo/chapter-1');
  });
});
