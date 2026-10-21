import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { KuronaviAdapter } from '../../../../../src/adapter/sites/kuronavi';
import { composeChapterImages, composeMetadata } from '../../../../../src/adapter/runtime-composer';
import { ComicError } from '../../../../../src/error/types';

const FIXTURES_DIR = path.join(__dirname, '../../../../fixtures/kuronavi');

let adapter: KuronaviAdapter;

describe('KuronaviAdapter', () => {
  KuronaviAdapterTestGroup1();
});

function composeChapterImagesTestGroup1(): void {
  it('should extract image URLs from chapter page through the extraction orchestrator', composeChapterImagesTestShouldExtractImageURLsFromChapterPageThroughTheExtractionOrchestrator);
  it('should raise a parsing error when the chapter page does not contain images', composeChapterImagesTestShouldRaiseAParsingErrorWhenTheChapterPageDoesNotContainImages);
}

async function composeChapterImagesTestShouldExtractImageURLsFromChapterPageThroughTheExtractionOrchestrator() {
    const html = fs.readFileSync(path.join(FIXTURES_DIR, 'chapter-page.html'), 'utf-8');
    const fetchHtmlSpy = jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue(html);
    const images = await composeChapterImages(adapter, 'https://kuronavi.one/manga/wanpisu/chapter-1182');
    expect(images).toHaveLength(5);
    expect(images[0].url).toBe('https://iphotomg.com/wanpisu/1182/1.jpg');
    expect(images[0].filename).toBe('001.jpg');
    expect(images[0].index).toBe(0);
    expect(images[4].url).toBe('https://iphotomg.com/wanpisu/1182/5.jpg');
    expect(images[4].filename).toBe('005.jpg');
    fetchHtmlSpy.mockRestore();
}

async function composeChapterImagesTestShouldRaiseAParsingErrorWhenTheChapterPageDoesNotContainImages() {
    const html = '<html><body><div class="page-chapter"></div></body></html>';
    const fetchHtmlSpy = jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue(html);
    await expect(composeChapterImages(adapter, 'https://kuronavi.one/manga/test/chapter-1')).rejects.toBeInstanceOf(ComicError);
    fetchHtmlSpy.mockRestore();
}

function composeMetadataTestGroup1(): void {
  it('should parse manga metadata from HTML through the extraction orchestrator', composeMetadataTestShouldParseMangaMetadataFromHTMLThroughTheExtractionOrchestrator);
  it('should reuse the metadata extraction result across fine-grained metadata fields', composeMetadataTestShouldReuseTheMetadataExtractionResultAcrossFineGrainedMetadataFields);
  it('should ignore non-chapter navigation links when the primary chapter-list wrapper is absent', composeMetadataTestShouldIgnoreNonChapterNavigationLinksWhenThePrimaryChapterListWrapperIsAbsent);
}

async function composeMetadataTestShouldParseMangaMetadataFromHTMLThroughTheExtractionOrchestrator() {
    const html = fs.readFileSync(path.join(FIXTURES_DIR, 'manga-page.html'), 'utf-8');
    const expected = readExpectedMetadata();
    const fetchHtmlSpy = jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue(html);
    const metadata = await composeMetadata(adapter, 'https://kuronavi.one/manga/wanpisu');
    expect(metadata.id).toBe(expected.id);
    expect(metadata.title).toBe(expected.title);
    expect(metadata.coverUrl).toBe(expected.cover);
    expect(metadata.description).toBe(expected.description);
    expect(metadata.status).toBe('ongoing');
    expect(metadata.tags).toEqual(expected.genres);
    expect(metadata.chapters).toHaveLength(expected.chapters.length);
    expect(metadata.chapters[0]).toMatchObject({
        id: expected.chapters[0].id,
        title: expected.chapters[0].title,
        url: expected.chapters[0].url,
    });
    fetchHtmlSpy.mockRestore();
}

function readExpectedMetadata() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'expected-metadata.json'), 'utf-8')) as {
    id: string; title: string; cover: string; description: string; genres: string[];
    chapters: Array<{ id: string; title: string; url: string }>;
  };
}

async function composeMetadataTestShouldReuseTheMetadataExtractionResultAcrossFineGrainedMetadataFields() {
    const html = fs.readFileSync(path.join(FIXTURES_DIR, 'manga-page.html'), 'utf-8');
    const fetchHtmlSpy = jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue(html);
    const extractSpy = jest.spyOn((adapter as any).metadata, 'extractMetadataDocument');
    await composeMetadata(adapter, 'https://kuronavi.one/manga/wanpisu');
    expect(extractSpy).toHaveBeenCalledTimes(1);
    extractSpy.mockRestore();
    fetchHtmlSpy.mockRestore();
}

async function composeMetadataTestShouldIgnoreNonChapterNavigationLinksWhenThePrimaryChapterListWrapperIsAbsent() {
    const fetchHtmlSpy = jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue(NO_WRAPPER_HTML);
    const metadata = await composeMetadata(adapter, 'https://kuronavi.one/manga/example');
    expect(metadata.chapters.map((chapter) => chapter.url)).toEqual([
        'https://kuronavi.one/manga/example/chapter-2',
        'https://kuronavi.one/manga/example/chapter-1',
    ]);
    expect(metadata.chapters.some((chapter) => chapter.url.includes('/search/manga'))).toBe(false);
    fetchHtmlSpy.mockRestore();
}

const NO_WRAPPER_HTML = `
        <html>
          <body>
            <main id="main-content">
              <h1>Example Manga</h1>
              <p>Example Author</p>
              <a href="https://kuronavi.one/search/manga">Search manga</a>
              <a href="https://kuronavi.one/search/manga?genre=action">Action</a>
              <a href="https://kuronavi.one/manga/example/chapter-2">Chapter 2</a>
              <a href="https://kuronavi.one/manga/example/chapter-1">Chapter 1</a>
            </main>
          </body>
        </html>
      `;

function KuronaviAdapterTestGroup1(): void {
  beforeEach(KuronaviAdapterTestScenario1);
  afterEach(KuronaviAdapterTestScenario2);
  describe('matchUrl', KuronaviAdapterTestMatchUrl);
  describe('composeMetadata', KuronaviAdapterTestComposeMetadata);
  describe('composeChapterImages', KuronaviAdapterTestComposeChapterImages);
  describe('adapter properties', KuronaviAdapterTestAdapterProperties);
}

function KuronaviAdapterTestScenario1() {
    adapter = new KuronaviAdapter();
}

async function KuronaviAdapterTestScenario2() {
    await adapter.dispose();
}

function KuronaviAdapterTestMatchUrl() {
    it('should match kuronavi.one manga URLs', () => {
        expect(adapter.matchUrl('https://kuronavi.one/manga/wanpisu')).toBe(true);
        expect(adapter.matchUrl('https://kuronavi.one/manga/wanpisu/chapter-1182')).toBe(true);
        expect(adapter.matchUrl('https://www.kuronavi.one/manga/test')).toBe(true);
    });
    it('should reject non-kuronavi URLs', () => {
        expect(adapter.matchUrl('https://example.com/manga/test')).toBe(false);
        expect(adapter.matchUrl('https://kuronavi.one/search/manga')).toBe(false);
        expect(adapter.matchUrl('https://kuronavi.one/')).toBe(false);
    });
}

function KuronaviAdapterTestComposeMetadata() {
    composeMetadataTestGroup1();
}

function KuronaviAdapterTestComposeChapterImages() {
    composeChapterImagesTestGroup1();
}

function KuronaviAdapterTestAdapterProperties() {
    it('should have correct id', () => {
        expect(adapter.id).toBe('kuronavi');
    });
    it('should have correct name', () => {
        expect(adapter.name).toBe('Kuronavi');
    });
    it('should have correct domains', () => {
        expect(adapter.domains).toEqual(['kuronavi.one']);
    });
    it('should use static parse mode', () => {
        expect(adapter.parseMode).toBe('playwright');
    });
}
