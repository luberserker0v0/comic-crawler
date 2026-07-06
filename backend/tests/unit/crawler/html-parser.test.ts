import { describe, it, expect, beforeEach } from '@jest/globals';
import { HtmlParser } from '../../../src/crawler/html-parser';

describe('HtmlParser', () => {
  let parser: HtmlParser;

  beforeEach(() => {
    parser = new HtmlParser();
  });

  it('should parse valid HTML', () => {
    const html = '<html><body><h1 class="title">Test</h1></body></html>';
    const $ = parser.parse(html);

    expect($('.title').text()).toBe('Test');
  });

  it('should throw on invalid HTML', () => {
    expect(() => parser.parse('')).toThrow();
    expect(() => parser.parse(null as any)).toThrow();
  });

  it('should extract text', () => {
    const html = '<div><p class="text">Hello World</p></div>';
    const $ = parser.parse(html);

    expect(parser.extractText($, '.text')).toBe('Hello World');
  });

  it('should extract attributes', () => {
    const html = '<a href="https://example.com">Link</a>';
    const $ = parser.parse(html);

    expect(parser.extractAttr($, 'a', 'href')).toBe('https://example.com');
  });

  it('should extract all items', () => {
    const html = '<ul><li>A</li><li>B</li><li>C</li></ul>';
    const $ = parser.parse(html);

    expect(parser.extractAll($, 'li')).toEqual(['A', 'B', 'C']);
  });

  it('should extract links', () => {
    const html = '<a href="/1">One</a><a href="/2">Two</a>';
    const $ = parser.parse(html);

    const links = parser.extractLinks($);
    expect(links).toEqual([
      { text: 'One', href: '/1' },
      { text: 'Two', href: '/2' },
    ]);
  });

  it('should extract images', () => {
    const html = '<img src="/1.jpg" alt="One"><img src="/2.jpg" alt="Two">';
    const $ = parser.parse(html);

    const images = parser.extractImages($);
    expect(images).toEqual([
      { src: '/1.jpg', alt: 'One' },
      { src: '/2.jpg', alt: 'Two' },
    ]);
  });

  it('should extract JSON from script', () => {
    const html = '<script type="application/json">{"title":"Test","chapters":[]}</script>';
    const $ = parser.parse(html);

    const json = parser.extractJsonFromScript($, 'script[type="application/json"]');
    expect(json).toEqual({ title: 'Test', chapters: [] });
  });

  it('should resolve URLs', () => {
    const html = '<a href="/comic/1">Link</a>';
    const $ = parser.parse(html);

    const urls = parser.resolveUrls($, 'a', 'https://example.com');
    expect(urls).toEqual(['https://example.com/comic/1']);
  });
});
