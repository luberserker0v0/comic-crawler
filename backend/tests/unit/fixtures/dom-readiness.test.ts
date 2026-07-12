import { describe, expect, it } from '@jest/globals';
import { DomReadinessChecker } from '../../../src/fixtures/dom-readiness';

describe('DomReadinessChecker', () => {
  const checker = new DomReadinessChecker();

  it('requires human verification for challenge HTML', () => {
    const report = checker.check({
      url: 'https://example.com/manga/demo',
      target: 'metadata',
      html: '<html><title>嗨皮漫画——人机验证</title><body>Sorry, you have been blocked</body></html>',
    });

    expect(report).toMatchObject({
      status: 'human_verification_required',
      recommendedAction: 'human_verification_handoff',
    });
  });

  it('marks metadata DOM without chapter links as needing a verified fixture', () => {
    const report = checker.check({
      url: 'https://example.com/manga/demo',
      target: 'metadata',
      html: '<html><head><title>Demo</title></head><body><h1>Demo Manga</h1></body></html>',
    });

    expect(report.status).toBe('needs_fixture_or_manual_review');
    expect(report.recommendedAction).toBe('capture_verified_fixture');
    expect(report.reasons.join(' ')).toContain('No chapter-list links');
  });

  it('marks chapter DOM without reader images as needing a verified fixture', () => {
    const report = checker.check({
      url: 'https://example.com/read/1',
      target: 'chapterImages',
      html: '<html><body><h1>Chapter 1</h1><p>No images yet</p></body></html>',
    });

    expect(report.status).toBe('needs_fixture_or_manual_review');
    expect(report.recommendedAction).toBe('capture_verified_fixture');
  });
});
