import { describe, expect, it } from '@jest/globals';
import { createCommonVerificationSkeleton } from '../../../src/selector-discovery/service-shell-compose';

describe('selector discovery common verification skeleton', () => {
  it('does not classify ordinary content containing the word challenge as verification', () => {
    const source = createCommonVerificationSkeleton(
      'https://example.com/chapter/1',
      'example.com'
    );

    expect(source).not.toContain('|blocked|challenge|');
    expect(source).toContain('cdn-cgi\\/challenge-platform');
    expect(source).toContain('verify you are human');
  });
});
