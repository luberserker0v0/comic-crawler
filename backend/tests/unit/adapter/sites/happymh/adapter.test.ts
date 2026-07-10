import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HappyMhAdapter } from '../../../../../src/adapter/sites/happymh';
import { composeChapterImages, composeMetadata } from '../../../../../src/adapter/runtime-composer';
import { ComicError } from '../../../../../src/error/types';

const FIXTURES_DIR = join(__dirname, '../../../../fixtures/happymh');

describe('HappyMhAdapter', () => {
  let adapter: HappyMhAdapter;

  beforeEach(() => {
    adapter = new HappyMhAdapter();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await adapter.dispose();
  });

  it('matches HappyMH manga catalog and chapter URLs', () => {
    expect(adapter.matchUrl('https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu')).toBe(true);
    expect(adapter.matchUrl('https://m.happymh.com/mangaread/wozaixingjiguojiadangedelingzhu/3279871')).toBe(true);
    expect(adapter.matchUrl('https://happymh.com/manga/demo')).toBe(false);
  });

  it('declares full adapter capabilities including verification handoff support', () => {
    expect(adapter.capabilities).toEqual({
      verification: true,
      metadata: true,
      chapterImages: true,
    });
    expect(adapter.parseMode).toBe('dynamic');
  });

  it('parses manga metadata and chapter list from fixture HTML', async () => {
    const html = readFileSync(join(FIXTURES_DIR, 'manga-page.html'), 'utf-8');
    const expected = JSON.parse(readFileSync(join(FIXTURES_DIR, 'expected-metadata.json'), 'utf-8')) as {
      id: string;
      title: string;
      cover: string;
      description: string;
      chapters: Array<{ id: string; title: string; url: string }>;
    };
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue(html);

    const metadata = await composeMetadata(adapter, 'https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu');

    expect(metadata.id).toBe(expected.id);
    expect(metadata.title).toBe(expected.title);
    expect(metadata.coverUrl).toBe(expected.cover);
    expect(metadata.description).toBe(expected.description);
    expect(metadata.chapters).toHaveLength(expected.chapters.length);
    expect(metadata.chapters[0]).toMatchObject(expected.chapters[0]);
  });

  it('ignores generic HappyMH headings and cleans site suffixes from manga title', async () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>我在星际国家当恶德领主 - 嗨皮漫画</title>
          <meta property="og:title" content="我在星际国家当恶德领主漫画全集" />
          <meta name="twitter:title" content="漫画评分" />
        </head>
        <body>
          <h1>漫画评分</h1>
          <section class="chapter-list">
            <a href="/mangaread/wozaixingjiguojiadangedelingzhu/3279871">第1话</a>
          </section>
        </body>
      </html>
    `;
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue(html);

    const metadata = await composeMetadata(adapter, 'https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu');

    expect(metadata.title).toBe('我在星际国家当恶德领主');
    expect(metadata.chapters).toHaveLength(1);
  });

  it('parses chapter image URLs from fixture HTML', async () => {
    const html = readFileSync(join(FIXTURES_DIR, 'chapter-page.html'), 'utf-8');
    const expected = JSON.parse(readFileSync(join(FIXTURES_DIR, 'expected-images.json'), 'utf-8')) as string[];
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue(html);

    const images = await composeChapterImages(adapter, 'https://m.happymh.com/mangaread/wozaixingjiguojiadangedelingzhu/3279871');

    expect(images.map((image) => image.url)).toEqual(expected);
    expect(images[0]).toMatchObject({ index: 0, filename: '001.webp' });
  });

  it('raises parsing error when no chapter images exist', async () => {
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html><body><article id="cp_img"></article></body></html>');

    await expect(composeChapterImages(adapter, 'https://m.happymh.com/mangaread/demo/1')).rejects.toBeInstanceOf(ComicError);
  });
});
