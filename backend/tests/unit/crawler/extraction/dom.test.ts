import { describe, it, expect, beforeEach } from '@jest/globals';
import * as cheerio from 'cheerio';
import { DomExtractionStrategy } from '../../../../src/crawler/extraction/strategies/dom';
import type { ExtractionContext } from '../../../../src/crawler/extraction/types';
import { ComicError } from '../../../../src/error/types';

let strategy: DomExtractionStrategy;

let context: ExtractionContext;

describe('DomExtractionStrategy', () => {
  DomExtractionStrategyTestGroup1();
});

function DomExtractionStrategyTestGroup1(): void {
  beforeEach(DomExtractionStrategyTestScenario1);
  it('should extract metadata', DomExtractionStrategyTestShouldExtractMetadata);
  it('should extract chapters', DomExtractionStrategyTestShouldExtractChapters);
  it('should extract images', DomExtractionStrategyTestShouldExtractImages);
  it('should validate context', DomExtractionStrategyTestShouldValidateContext);
  it('should raise a parsing error when required metadata is missing', DomExtractionStrategyTestShouldRaiseAParsingErrorWhenRequiredMetadataIsMissing);
}

function DomExtractionStrategyTestScenario1() {
    strategy = new DomExtractionStrategy();
    context = { selectors: DOM_SELECTORS, baseUrl: 'https://example.com' };
}

const DOM_SELECTORS = {
  metadata: { title: '.title', author: '.author', cover: '.cover img',
    status: '.status', tags: '.tag', description: '.description' },
  chapters: { list: '.chapter-list', item: '.chapter-item', title: '.chapter-title', url: 'a' },
  images: { container: '.image-container', item: 'img', srcAttr: 'src' },
};

async function DomExtractionStrategyTestShouldExtractMetadata() {
    context.$ = cheerio.load(METADATA_HTML);
    const metadata = await strategy.extractMetadata(context);
    expect(metadata.title).toBe('Test Comic');
    expect(metadata.author).toBe('Test Author');
    expect(metadata.description).toBe('A pirate adventure.');
    expect(metadata.status).toBe('ongoing');
    expect(metadata.tags).toEqual(['Action', 'Adventure']);
    expect(metadata.chapters[0].id).toBe('1');
}

const METADATA_HTML = `
      <html>
        <body>
          <h1 class="title">Test Comic</h1>
          <span class="author">Test Author</span>
          <span class="status">Ongoing</span>
          <div class="tag">Action</div>
          <div class="tag">Adventure</div>
          <div class="description">A pirate adventure.</div>
          <div class="cover"><img src="/cover.jpg"></div>
          <div class="chapter-list">
            <div class="chapter-item">
              <a href="/chapter/1"><span class="chapter-title">Chapter 1</span></a>
            </div>
          </div>
        </body>
      </html>
    `;

async function DomExtractionStrategyTestShouldExtractChapters() {
    context.$ = cheerio.load(CHAPTERS_HTML);
    const chapters = await strategy.extractChapters(context);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].id).toBe('1');
    expect(chapters[0].title).toBe('Chapter 1');
    expect(chapters[0].url).toBe('https://example.com/chapter/1');
}

const CHAPTERS_HTML = `
      <html>
        <body>
          <div class="chapter-list">
            <div class="chapter-item">
              <a href="/chapter/1"><span class="chapter-title">Chapter 1</span></a>
            </div>
            <div class="chapter-item">
              <a href="/chapter/2"><span class="chapter-title">Chapter 2</span></a>
            </div>
          </div>
        </body>
      </html>
    `;

async function DomExtractionStrategyTestShouldExtractImages() {
    const html = `
      <html>
        <body>
          <div class="image-container">
            <img src="/page1.jpg">
            <img src="/page2.jpg">
            <img src="/page3.jpg">
          </div>
        </body>
      </html>
    `;
    context.$ = cheerio.load(html);
    const images = await strategy.extractImages(context);
    expect(images).toHaveLength(3);
    expect(images[0].url).toBe('https://example.com/page1.jpg');
    expect(images[0].filename).toBe('001.jpg');
    expect(images[0].index).toBe(0);
}

async function DomExtractionStrategyTestShouldValidateContext() {
    const html = `
      <html>
        <body>
          <h1 class="title">Test</h1>
          <div class="chapter-list">
            <div class="chapter-item"><a href="/chapter/1">Chapter 1</a></div>
          </div>
          <img src="/test.jpg">
        </body>
      </html>
    `;
    context.$ = cheerio.load(html);
    const isValid = await strategy.validate(context);
    expect(isValid).toBe(true);
}

async function DomExtractionStrategyTestShouldRaiseAParsingErrorWhenRequiredMetadataIsMissing() {
    const html = '<html><body></body></html>';
    context.$ = cheerio.load(html);
    await expect(strategy.extractMetadata(context)).rejects.toBeInstanceOf(ComicError);
}
