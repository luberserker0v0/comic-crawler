import { describe, expect, it } from '@jest/globals';
import { DomReadinessChecker } from '../../../src/fixtures/dom-readiness';

const checker = new DomReadinessChecker();

describe('DomReadinessChecker', () => {
  DomReadinessCheckerTestGroup1();
});

function DomReadinessCheckerTestGroup1(): void {
  it('requires human verification for challenge HTML', DomReadinessCheckerTestRequiresHumanVerificationForChallengeHTML);
  it('marks metadata DOM without chapter links as needing a verified fixture', DomReadinessCheckerTestMarksMetadataDOMWithoutChapterLinksAsNeedingAVerifiedFixture);
  it('marks chapter DOM without reader images as needing a verified fixture', DomReadinessCheckerTestMarksChapterDOMWithoutReaderImagesAsNeedingAVerifiedFixture);
  it('rejects a partially hydrated reader DOM', DomReadinessCheckerTestRejectsAPartiallyHydratedReaderDOM);
  it('rejects extraction with fewer URLs than reader pages', DomReadinessCheckerTestRejectsExtractionWithFewerURLsThanReaderPages);
  it('accepts Browser Client annotations for virtualized reader pages', DomReadinessCheckerTestAcceptsBrowserClientAnnotationsForVirtualizedReaderPages);
}

function DomReadinessCheckerTestRequiresHumanVerificationForChallengeHTML() {
    const report = checker.check({
        url: 'https://example.com/manga/demo',
        target: 'metadata',
        html: '<html><title>嗨皮漫画——人机验证</title><body>Sorry, you have been blocked</body></html>',
    });
    expect(report).toMatchObject({
        status: 'human_verification_required',
        recommendedAction: 'human_verification_handoff',
    });
}

function DomReadinessCheckerTestMarksMetadataDOMWithoutChapterLinksAsNeedingAVerifiedFixture() {
    const report = checker.check({
        url: 'https://example.com/manga/demo',
        target: 'metadata',
        html: '<html><head><title>Demo</title></head><body><h1>Demo Manga</h1></body></html>',
    });
    expect(report.status).toBe('needs_fixture_or_manual_review');
    expect(report.recommendedAction).toBe('capture_verified_fixture');
    expect(report.reasons.join(' ')).toContain('No chapter-list links');
}

function DomReadinessCheckerTestMarksChapterDOMWithoutReaderImagesAsNeedingAVerifiedFixture() {
    const report = checker.check({
        url: 'https://example.com/read/1',
        target: 'chapterImages',
        html: '<html><body><h1>Chapter 1</h1><p>No images yet</p></body></html>',
    });
    expect(report.status).toBe('needs_fixture_or_manual_review');
    expect(report.recommendedAction).toBe('capture_verified_fixture');
}

function DomReadinessCheckerTestRejectsAPartiallyHydratedReaderDOM() {
    const report = checker.check({
        url: 'https://example.com/read/1',
        target: 'chapterImages',
        html: `
        <main class="reader">
          <div class="rpage-page" data-page="1"><img src="/1.jpg"></div>
          <div class="rpage-page" data-page="2"><img src="/2.jpg"></div>
          <div class="rpage-page" data-page="3"><div class="loader"></div></div>
        </main>
      `,
    });
    expect(report.status).toBe('needs_fixture_or_manual_review');
    expect(report.confidence).toBe(0.45);
    expect(report.reasons.join(' ')).toContain('2 of 3 page containers');
}

function DomReadinessCheckerTestRejectsExtractionWithFewerURLsThanReaderPages() {
    const report = checker.check({
        url: 'https://example.com/read/1',
        target: 'chapterImages',
        html: `
        <main class="reader">
          <div class="reader-page"><img src="/1.jpg"></div>
          <div class="reader-page"><img src="/2.jpg"></div>
        </main>
      `,
        extractionResult: { imageUrls: ['https://example.com/1.jpg'] },
    });
    expect(report.status).toBe('needs_fixture_or_manual_review');
    expect(report.recommendedAction).toBe('manual_review');
    expect(report.reasons.join(' ')).toContain('1 image URLs for 2 reader pages');
}

function DomReadinessCheckerTestAcceptsBrowserClientAnnotationsForVirtualizedReaderPages() {
    const report = checker.check({
        url: 'https://example.com/read/1',
        target: 'chapterImages',
        html: `
        <main class="reader">
          <div class="rpage-page" data-page="1" data-comiccrawler-image-url="https://img.example/1.jpg"></div>
          <div class="rpage-page" data-page="2" data-comiccrawler-image-url="https://img.example/2.jpg"></div>
        </main>
      `,
        extractionResult: { imageUrls: ['https://img.example/1.jpg', 'https://img.example/2.jpg'] },
    });
    expect(report.status).toBe('ready');
    expect(report.recommendedAction).toBe('continue');
}
