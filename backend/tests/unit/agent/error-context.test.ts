import { describe, it, expect } from '@jest/globals';
import { buildExtractionFailureContext } from '../../../src/agent/error-context';
import { KURONAVI_SITE_MANIFEST } from '../../../src/adapter/sites/kuronavi';

describe('buildExtractionFailureContext', () => {
  it('should include repair targets and fixture references', () => {
    const context = buildExtractionFailureContext({
      adapterId: 'kuronavi',
      manifest: KURONAVI_SITE_MANIFEST,
      pageType: 'metadata',
      selector: 'h1',
      selectorName: 'metadata.title',
      url: 'https://kuronavi.one/manga/wanpisu',
      html: '<html><body><h1>sample</h1></body></html>',
      message: 'Missing title selector output',
    });

    expect(context.adapterId).toBe('kuronavi');
    expect(context.repairMode).toBe('selector-only');
    expect(context.repairTargets).toEqual(['selectors.ts']);
    expect(context.fixtureRefs).toContain('manga-page.html');
    expect(context.fixtureRefs).toContain('expected-metadata.json');
    expect(context.pageType).toBe('metadata');
    expect(context.selector).toBe('h1');
    expect(context.selectorName).toBe('metadata.title');
    expect(context.htmlSample).toContain('<h1>sample</h1>');
  });
});
