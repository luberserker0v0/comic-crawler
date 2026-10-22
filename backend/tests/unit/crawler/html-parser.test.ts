import { describe, it, expect, beforeEach } from '@jest/globals';
import { HtmlParser } from '../../../src/crawler/html-parser';

let parser: HtmlParser;

describe('HtmlParser', () => {
  HtmlParserTestGroup1();
});

function HtmlParserTestGroup1(): void {
  beforeEach(HtmlParserTestScenario1);
  it('should parse valid HTML', HtmlParserTestShouldParseValidHTML);
  it('should throw on invalid HTML', HtmlParserTestShouldThrowOnInvalidHTML);
  it('should extract text', HtmlParserTestShouldExtractText);
  it('should extract attributes', HtmlParserTestShouldExtractAttributes);
  it('should extract all items', HtmlParserTestShouldExtractAllItems);
  it('should extract links', HtmlParserTestShouldExtractLinks);
  it('should extract images', HtmlParserTestShouldExtractImages);
  it('should extract JSON from script', HtmlParserTestShouldExtractJSONFromScript);
  it('should resolve URLs', HtmlParserTestShouldResolveURLs);
}

function HtmlParserTestScenario1() {
    parser = new HtmlParser();
}

function HtmlParserTestShouldParseValidHTML() {
    const html = '<html><body><h1 class="title">Test</h1></body></html>';
    const $ = parser.parse(html);
    expect($('.title').text()).toBe('Test');
}

function HtmlParserTestShouldThrowOnInvalidHTML() {
    expect(() => parser.parse('')).toThrow();
    expect(() => parser.parse(null as any)).toThrow();
}

function HtmlParserTestShouldExtractText() {
    const html = '<div><p class="text">Hello World</p></div>';
    const $ = parser.parse(html);
    expect(parser.extractText($, '.text')).toBe('Hello World');
}

function HtmlParserTestShouldExtractAttributes() {
    const html = '<a href="https://example.com">Link</a>';
    const $ = parser.parse(html);
    expect(parser.extractAttr($, 'a', 'href')).toBe('https://example.com');
}

function HtmlParserTestShouldExtractAllItems() {
    const html = '<ul><li>A</li><li>B</li><li>C</li></ul>';
    const $ = parser.parse(html);
    expect(parser.extractAll($, 'li')).toEqual(['A', 'B', 'C']);
}

function HtmlParserTestShouldExtractLinks() {
    const html = '<a href="/1">One</a><a href="/2">Two</a>';
    const $ = parser.parse(html);
    const links = parser.extractLinks($);
    expect(links).toEqual([
        { text: 'One', href: '/1' },
        { text: 'Two', href: '/2' },
    ]);
}

function HtmlParserTestShouldExtractImages() {
    const html = '<img src="/1.jpg" alt="One"><img src="/2.jpg" alt="Two">';
    const $ = parser.parse(html);
    const images = parser.extractImages($);
    expect(images).toEqual([
        { src: '/1.jpg', alt: 'One' },
        { src: '/2.jpg', alt: 'Two' },
    ]);
}

function HtmlParserTestShouldExtractJSONFromScript() {
    const html = '<script type="application/json">{"title":"Test","chapters":[]}</script>';
    const $ = parser.parse(html);
    const json = parser.extractJsonFromScript($, 'script[type="application/json"]');
    expect(json).toEqual({ title: 'Test', chapters: [] });
}

function HtmlParserTestShouldResolveURLs() {
    const html = '<a href="/comic/1">Link</a>';
    const $ = parser.parse(html);
    const urls = parser.resolveUrls($, 'a', 'https://example.com');
    expect(urls).toEqual(['https://example.com/comic/1']);
}
