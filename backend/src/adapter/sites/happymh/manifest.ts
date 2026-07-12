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
    selectorExportName: 'HAPPYMH_SELECTORS',
  },
};
