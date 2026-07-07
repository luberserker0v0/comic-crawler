import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HappyMhAdapter } from '../../../../../src/adapter/sites/happymh';
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

    const metadata = await adapter.fetchMetadata('https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu');

    expect(metadata.id).toBe(expected.id);
    expect(metadata.title).toBe(expected.title);
    expect(metadata.coverUrl).toBe(expected.cover);
    expect(metadata.description).toBe(expected.description);
    expect(metadata.chapters).toHaveLength(expected.chapters.length);
    expect(metadata.chapters[0]).toMatchObject(expected.chapters[0]);
  });

  it('parses chapter image URLs from fixture HTML', async () => {
    const html = readFileSync(join(FIXTURES_DIR, 'chapter-page.html'), 'utf-8');
    const expected = JSON.parse(readFileSync(join(FIXTURES_DIR, 'expected-images.json'), 'utf-8')) as string[];
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue(html);

    const images = await adapter.fetchChapterImages('https://m.happymh.com/mangaread/wozaixingjiguojiadangedelingzhu/3279871');

    expect(images.map((image) => image.url)).toEqual(expected);
    expect(images[0]).toMatchObject({ index: 0, filename: '001.webp' });
  });

  it('raises parsing error when no chapter images exist', async () => {
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<html><body><article id="cp_img"></article></body></html>');

    await expect(adapter.fetchChapterImages('https://m.happymh.com/mangaread/demo/1')).rejects.toBeInstanceOf(ComicError);
  });
});
