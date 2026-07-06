import type { SiteSelectors } from '@comiccrawler/shared';

export const KURONAVI_SELECTORS: SiteSelectors = {
  metadata: {
    title: 'h1',
    author: 'main p',
    cover: 'img[itemprop="image"], meta[itemprop="image"]',
    status: 'main span',
    tags: 'a[href*="genre="]',
    description: '.description',
  },
  chapters: {
    list: '.chapter-list, #main-content',
    item: 'a[href*="/chapter-"]',
    title: 'a[href*="/chapter-"]',
    url: 'a[href*="/chapter-"]',
  },
  images: {
    container: '.box_doc.reading-detail',
    item: '.page-chapter img[data-original]',
    srcAttr: 'data-original',
  },
} as const;
