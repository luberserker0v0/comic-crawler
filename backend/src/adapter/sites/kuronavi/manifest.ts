import { join } from 'node:path';
import type { SiteManifest } from '../types';
import { KURONAVI_SELECTORS } from './selectors';

export const KURONAVI_SITE_MANIFEST: SiteManifest = {
  id: 'kuronavi',
  parseMode: 'static',
  selectors: KURONAVI_SELECTORS,
  maintenance: {
    repairMode: 'selector-only',
    repairTargets: ['selectors.ts'],
    sourceRoot: __dirname,
    fixturesRoot: join(__dirname, '../../../../tests/fixtures/kuronavi'),
    selectorExportName: 'KURONAVI_SELECTORS',
    metadataFixture: {
      name: 'metadata',
      baseUrl: 'https://kuronavi.one/manga/wanpisu',
      htmlFile: 'manga-page.html',
      expectedFile: 'expected-metadata.json',
    },
    imageFixture: {
      name: 'images',
      baseUrl: 'https://kuronavi.one/manga/wanpisu/chapter-1182',
      htmlFile: 'chapter-page.html',
      expectedFile: 'expected-images.json',
    },
  },
} as const;
