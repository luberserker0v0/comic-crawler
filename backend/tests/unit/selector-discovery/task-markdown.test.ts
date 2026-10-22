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
  selectorDiscoveryTaskMarkdownTestGroup1();
});

function selectorDiscoveryTaskMarkdownTestGroup1(): void {
  it('creates a chapter-only prompt focused on image extraction', selectorDiscoveryTaskMarkdownTestCreatesAChapterOnlyPromptFocusedOnImageExtraction);
  it('documents AdapterBase implementation and non-comic image exclusions in AO prompts', selectorDiscoveryTaskMarkdownTestDocumentsAdapterBaseImplementationAndNonComicImageExclusionsInAOPrompts);
  it('extracts representative chapter URLs and strips ASCII trailing punctuation', selectorDiscoveryTaskMarkdownTestExtractsRepresentativeChapterURLsAndStripsASCIITrailingPunctuation);
  it('finds fallback chapter links from common reader URL signals', selectorDiscoveryTaskMarkdownTestFindsFallbackChapterLinksFromCommonReaderURLSignals);
  it('rejects Phase 1 outputs that are only a plan or waiting note', selectorDiscoveryTaskMarkdownTestRejectsPhase1OutputsThatAreOnlyAPlanOrWaitingNote);
}

function selectorDiscoveryTaskMarkdownTestCreatesAChapterOnlyPromptFocusedOnImageExtraction() {
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
    expect(markdown).toContain('no JSON or\n  AdapterBase shell');
    expect(markdown).toContain('Capability Implementation Contract');
    expect(markdown).toContain('Browser preparation is upstream');
    expect(markdown).not.toContain('Choose one representative chapter URL');
}

function selectorDiscoveryTaskMarkdownTestDocumentsAdapterBaseImplementationAndNonComicImageExclusionsInAOPrompts() {
    const chapterFetch = chapterFetchFixture();
    const phase1 = createPhase1TaskMarkdown(metadataTaskFixture());
    const phase2 = createPhase2TaskMarkdown({
        url: 'https://example.com/manga/demo',
        phase1Markdown: 'Representative Chapter URL: /manga/demo/chapter-1',
        chapterFetch,
    });
    const chapterOnly = createChapterOnlyTaskMarkdown({
        url: 'https://example.com/manga/demo/chapter-1',
        chapterFetch,
    });
    expectMetadataPromptContract(phase1);
    expectImagePromptContract(phase2, chapterOnly);
}

function expectMetadataPromptContract(phase1: string): void {
    expect(phase1).toContain('Flag collapsed or incomplete catalogs');
    expect(phase1).toContain('read/continue shortcuts');
    expect(phase1).toContain('Capability Implementation Contract');
}

function expectImagePromptContract(phase2: string, chapterOnly: string): void {
    expect(phase2).toContain('reusable chapter-image capability');
    expect(phase2).toContain('representative reader URL');
    expect(phase2).toContain('exclude covers, logos, UI, ads');
    expect(phase2).toContain('TypeScript capability drafts');
    expect(phase2).toContain('AdapterBase shell');
    expect(chapterOnly).toContain('Chapter Image URL Extraction is required');
    expect(chapterOnly).toContain('not broad image selectors');
    expect(chapterOnly).toContain('lazy-load/CDN signals');
    expect(chapterOnly).not.toContain('site-specific clicking');
}

function chapterFetchFixture() {
  const url = 'https://example.com/manga/demo/chapter-1';
  return {
    url, finalUrl: url, redirectChain: [], contentType: 'text/html',
    html: '<html><body><main class="reader"><img data-src="/001.jpg"></main></body></html>',
  };
}

function metadataTaskFixture() {
  const url = 'https://example.com/manga/demo';
  return { url, metadataFetch: {
    url, finalUrl: url, redirectChain: [], contentType: 'text/html',
    html: '<html><body><a href="/manga/demo/chapter-1">Chapter 1</a></body></html>',
  } };
}

function selectorDiscoveryTaskMarkdownTestExtractsRepresentativeChapterURLsAndStripsASCIITrailingPunctuation() {
    expect(extractRepresentativeChapterUrl('## Representative Chapter URL\n\nhttps://example.com/manga/demo/chapter-1).', 'https://example.com/manga/demo')).toBe('https://example.com/manga/demo/chapter-1');
}

function selectorDiscoveryTaskMarkdownTestFindsFallbackChapterLinksFromCommonReaderURLSignals() {
    const html = `
      <a href="/about">About</a>
      <a href="/manga/demo/chapter-1">Read chapter 1</a>
      <a href="/viewer/demo/2">Viewer</a>
    `;
    expect(extractFallbackChapterUrlFromHtml(html, 'https://example.com/manga/demo'))
        .toBe('https://example.com/manga/demo/chapter-1');
}

function selectorDiscoveryTaskMarkdownTestRejectsPhase1OutputsThatAreOnlyAPlanOrWaitingNote() {
    const result = validatePhase1Markdown('I am waiting for the dom-structure-analyst task result. Here is the plan.');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required Phase 1 heading: ## Site Decision');
    expect(result.errors).toContain('Phase 1 output appears to be a plan or waiting note rather than analysis.');
}
