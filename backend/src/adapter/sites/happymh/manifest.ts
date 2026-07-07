import type { SiteManifest } from '../types';
import { HAPPYMH_SELECTORS } from './selectors';

export const HAPPYMH_SITE_MANIFEST: SiteManifest = {
  id: 'happymh',
  parseMode: 'dynamic',
  selectors: HAPPYMH_SELECTORS,
  maintenance: {
    repairMode: 'selector-only',
    repairTargets: ['metadata', 'chapters', 'images'],
    sourceRoot: 'backend/src/adapter/sites/happymh',
    fixturesRoot: 'backend/tests/fixtures/happymh',
    selectorExportName: 'HAPPYMH_SELECTORS',
    metadataFixture: {
      name: 'HappyMH manga catalog',
      baseUrl: 'https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu',
      htmlFile: 'manga-page.html',
      expectedFile: 'expected-metadata.json',
    },
    imageFixture: {
      name: 'HappyMH chapter reader',
      baseUrl: 'https://m.happymh.com/mangaread/wozaixingjiguojiadangedelingzhu/3279871',
      htmlFile: 'chapter-page.html',
      expectedFile: 'expected-images.json',
    },
  },
};
