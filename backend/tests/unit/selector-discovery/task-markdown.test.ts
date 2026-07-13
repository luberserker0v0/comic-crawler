import { describe, expect, it } from '@jest/globals';
import {
  createPhase1TaskMarkdown,
  createPhase2TaskMarkdown,
  createChapterOnlyTaskMarkdown,
  extractFallbackChapterUrlFromHtml,
  extractRepresentativeChapterUrl,
  validatePhase1Markdown,
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
    expect(markdown).toContain('Metadata extraction functions are not required.');
    expect(markdown).toContain('Chapter Image URL Extraction is required.');
    expect(markdown).toContain('Do not write an AdapterBase shell');
    expect(markdown).toContain('Capability Implementation Contract');
    expect(markdown).not.toContain('Choose one representative chapter URL');
  });

  it('documents AdapterBase implementation and non-comic image exclusions in AO prompts', () => {
    const chapterFetch = {
      url: 'https://example.com/manga/demo/chapter-1',
      finalUrl: 'https://example.com/manga/demo/chapter-1',
      redirectChain: [],
      contentType: 'text/html',
      html: '<html><body><main class="reader"><img data-src="/001.jpg"></main></body></html>',
    };
    const phase1 = createPhase1TaskMarkdown({
      url: 'https://example.com/manga/demo',
      metadataFetch: {
        url: 'https://example.com/manga/demo',
        finalUrl: 'https://example.com/manga/demo',
        redirectChain: [],
        contentType: 'text/html',
        html: '<html><body><a href="/manga/demo/chapter-1">Chapter 1</a></body></html>',
      },
    });
    const phase2 = createPhase2TaskMarkdown({
      url: 'https://example.com/manga/demo',
      phase1Markdown: 'Representative Chapter URL: /manga/demo/chapter-1',
      chapterFetch,
    });
    const chapterOnly = createChapterOnlyTaskMarkdown({
      url: 'https://example.com/manga/demo/chapter-1',
      chapterFetch,
    });

    expect(phase1).toContain('If the chapter list appears partial');
    expect(phase1).toContain('start reading');
    expect(phase1).toContain('Capability Implementation Contract');
    expect(phase2).toContain('reusable chapter-only unit');
    expect(phase2).toContain('not a metadata/catalog page');
    expect(phase2).toContain('Exclude covers, logos, browser/app promotion icons');
    expect(phase2).toContain('TypeScript capability drafts');
    expect(phase2).toContain('Do not write an AdapterBase shell');
    expect(chapterOnly).toContain('reusable image extraction unit');
    expect(chapterOnly).toContain('Do not use broad selectors');
    expect(chapterOnly).toContain('comic CDN/lazy-loading attributes');
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

  it('rejects Phase 1 outputs that are only a plan or waiting note', () => {
    const result = validatePhase1Markdown('I am waiting for the dom-structure-analyst task result. Here is the plan.');

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required Phase 1 heading: ## Site Decision');
    expect(result.errors).toContain('Phase 1 output appears to be a plan or waiting note rather than analysis.');
  });
});
