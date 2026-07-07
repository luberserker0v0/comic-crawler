import type { SiteSelectors } from '@comiccrawler/shared';

export const HAPPYMH_SELECTORS: SiteSelectors = {
  metadata: {
    title: 'h1, .comic-title, .detail-title, .manga-title, meta[property="og:title"], title',
    author: '.author, .comic-author, .detail-author, a[href*="author"]',
    cover: 'meta[property="og:image"], .cover img, .comic-cover img, .detail-cover img, img[src*="cover"]',
    status: '.status, .comic-status, .detail-status',
    tags: '.tags a, .tag a, a[href*="tag"], a[href*="category"]',
    description: '.description, .summary, .intro, .comic-description, .detail-desc, meta[name="description"]',
  },
  chapters: {
    list: '.chapter-list, .chapterList, .catalog-list, .episode-list, .mh-chapter-list, body',
    item: 'a[href*="/mangaread/"]',
    title: 'a[href*="/mangaread/"]',
    url: 'a[href*="/mangaread/"]',
  },
  images: {
    container: '#cp_image, #cp_img, .comicpage, .reader, .read-content, .chapter-content, body',
    item: 'img[data-original], img[data-src], img[data-url], img[src]',
    srcAttr: 'data-original',
  },
} as const;
