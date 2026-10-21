import { describe, it, expect } from '@jest/globals';
import { buildExtractionFailureContext } from '../../../src/agent/error-context';
import { KURONAVI_SITE_MANIFEST } from '../../../src/adapter/sites/kuronavi';

describe('buildExtractionFailureContext', () => {
  buildExtractionFailureContextTestGroup1();
});

function buildExtractionFailureContextTestGroup1(): void {
  it('should include repair targets and fixture references', buildExtractionFailureContextTestShouldIncludeRepairTargetsAndFixtureReferences);
}

function buildExtractionFailureContextTestShouldIncludeRepairTargetsAndFixtureReferences() {
    const context = buildExtractionFailureContext(extractionFailureInput());
    expect(context.adapterId).toBe('kuronavi');
    expect(context.repairMode).toBe('selector-only');
    expect(context.repairTargets).toEqual(['selectors.ts']);
    expect(context.fixtureRefs).toContain('manga-page.html');
    expect(context.fixtureRefs).toContain('expected-metadata.json');
    expect(context.pageType).toBe('metadata');
    expect(context.selector).toBe('h1');
    expect(context.selectorName).toBe('metadata.title');
    expect(context.htmlSample).toContain('<h1>sample</h1>');
}

function extractionFailureInput() {
  return {
    adapterId: 'kuronavi', manifest: KURONAVI_SITE_MANIFEST,
    pageType: 'metadata' as const, selector: 'h1',
    selectorName: 'metadata.title',
    url: 'https://kuronavi.one/manga/wanpisu',
    html: '<html><body><h1>sample</h1></body></html>',
    message: 'Missing title selector output',
  };
}
