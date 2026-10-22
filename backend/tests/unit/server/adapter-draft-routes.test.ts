import { describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterDraftService } from '../../../src/adapter-drafts/service';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { DynamicSiteAdapter } from '../../../src/adapter/dynamic-site-adapter';
import { HappyMhAdapter } from '../../../src/adapter/sites/happymh';
import { setupAdapterDraftRoutes } from '../../../src/server/routes/adapter-drafts';

async function createApp() {
    const userPath = await mkdtemp(join(tmpdir(), 'comiccrawler-drafts-user-'));
    const registry = new AdapterRegistry();
    registry.register(new HappyMhAdapter());
    registry.register(dynamicDemoAdapter());
    const service = new AdapterDraftService(userPath, registry);
    const app = fastify();
    setupAdapterDraftRoutes(app, service, {
      htmlRenderer: { render: async () => '<html></html>', dispose: async () => undefined },
    });
    return { app, userPath, service };
  }

function dynamicDemoAdapter(): DynamicSiteAdapter {
  return new DynamicSiteAdapter({
      adapterId: 'dynamic-demo',
      name: 'Dynamic Demo',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/read/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'disc-1',
      promotedAt: '2026-07-09T00:00:00.000Z',
  });
}

type DraftApp = Awaited<ReturnType<typeof createApp>>;

async function withDraftApp(run: (fixture: DraftApp) => Promise<void>): Promise<void> {
  const fixture = await createApp();
  try { await run(fixture); }
  finally {
    await fixture.app.close();
    await rm(fixture.userPath, { recursive: true, force: true });
  }
}

describe('Adapter draft routes', () => {
  AdapterDraftRoutesTestGroup1();
});

function AdapterDraftRoutesTestGroup1(): void {
  it('creates, reads, saves, resets, and discards a dynamic manifest draft under user data', AdapterDraftRoutesTestCreatesReadsSavesResetsAndDiscardsADynamicManifestDraftUnderUserData);
  it('tests dynamic manifest drafts without registering them as active adapters', AdapterDraftRoutesTestTestsDynamicManifestDraftsWithoutRegisteringThemAsActiveAdapters);
  it('executes project-source TypeScript drafts without replacing the active adapter', AdapterDraftRoutesTestExecutesProjectSourceTypeScriptDraftsWithoutReplacingTheActiveAdapter);
  it('executes generated TypeScript implementation drafts without registering them', AdapterDraftRoutesTestExecutesGeneratedTypeScriptImplementationDraftsWithoutRegisteringThem);
  it('creates a read/edit draft copy for allowlisted project source', AdapterDraftRoutesTestCreatesAReadEditDraftCopyForAllowlistedProjectSource);
}

async function AdapterDraftRoutesTestCreatesReadsSavesResetsAndDiscardsADynamicManifestDraftUnderUserData() {
    await withDraftApp(runDynamicDraftLifecycle);
}

async function runDynamicDraftLifecycle({ app, userPath }: DraftApp): Promise<void> {
        const created = await app.inject({ method: 'POST', url: '/api/adapters/dynamic-demo/drafts' });
        expect(created.statusCode).toBe(200);
        const draftId = created.json().data.draft.draftId as string;
        expect(created.json().data).toMatchObject({
            draft: {
                baseAdapterId: 'dynamic-demo',
                sourceKind: 'dynamic-manifest',
                language: 'json',
                status: 'editing',
            },
        });
        expect(created.json().data.content).toContain('"adapterId": "dynamic-demo"');
        expect(await readFile(join(userPath, 'adapter-drafts', draftId, 'manifest.json'), 'utf-8')).toContain('dynamic-demo');
        await saveResetAndDiscard(app, draftId);
}

async function saveResetAndDiscard(app: DraftApp['app'], draftId: string): Promise<void> {
        const saved = await app.inject({
            method: 'PUT',
            url: `/api/adapter-drafts/${draftId}/content`,
            payload: { content: '{ "changed": true }' },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json().data.content).toBe('{ "changed": true }');
        const reset = await app.inject({ method: 'POST', url: `/api/adapter-drafts/${draftId}/reset` });
        expect(reset.statusCode).toBe(200);
        expect(reset.json().data.content).toContain('"adapterId": "dynamic-demo"');
        const list = await app.inject({ method: 'GET', url: '/api/adapter-drafts' });
        expect(list.statusCode).toBe(200);
        expect(list.json().data.drafts).toEqual(expect.arrayContaining(
          [expect.objectContaining({ draftId, baseAdapterId: 'dynamic-demo' })]));
        const discarded = await app.inject({ method: 'DELETE', url: `/api/adapter-drafts/${draftId}` });
        expect(discarded.statusCode).toBe(200);
        const afterDiscard = await app.inject({ method: 'GET', url: `/api/adapter-drafts/${draftId}` });
        expect(afterDiscard.statusCode).toBe(404);
}

async function AdapterDraftRoutesTestTestsDynamicManifestDraftsWithoutRegisteringThemAsActiveAdapters() {
    await withDraftApp(runDynamicManifestTest);
}

async function runDynamicManifestTest({ app }: DraftApp): Promise<void> {
        const created = await app.inject({ method: 'POST', url: '/api/adapters/dynamic-demo/drafts' });
        const draftId = created.json().data.draft.draftId as string;
        const manifest = JSON.parse(created.json().data.content);
        manifest.urlPatterns = ['https://example.com/draft-read/*'];
        await app.inject({
            method: 'PUT',
            url: `/api/adapter-drafts/${draftId}/content`,
            payload: { content: JSON.stringify(manifest, null, 2) },
        });
        await expectDraftMatchResults(app, draftId);
}

async function expectDraftMatchResults(app: DraftApp['app'], draftId: string): Promise<void> {
        const matched = await app.inject({
            method: 'POST',
            url: `/api/adapter-drafts/${draftId}/functions/matchUrl/test`,
            payload: { url: 'https://example.com/draft-read/1' },
        });
        const unmatched = await app.inject({
            method: 'POST',
            url: `/api/adapter-drafts/${draftId}/functions/matchUrl/test`,
            payload: { url: 'https://example.com/read/1' },
        });
        expect(matched.statusCode).toBe(200);
        expect(matched.json().data).toMatchObject({ ok: true, adapterId: draftId,
          resultSummary: { matched: true, draftId, baseAdapterId: 'dynamic-demo' } });
        expect(unmatched.statusCode).toBe(200);
        expect(unmatched.json().data.resultSummary.matched).toBe(false);
}

async function AdapterDraftRoutesTestExecutesProjectSourceTypeScriptDraftsWithoutReplacingTheActiveAdapter() {
    await withDraftApp(runProjectSourceDraft);
}

async function runProjectSourceDraft({ app }: DraftApp): Promise<void> {
        const created = await app.inject({ method: 'POST', url: '/api/adapters/happymh/drafts' });
        const draftId = created.json().data.draft.draftId as string;
        const response = await app.inject({
            method: 'POST',
            url: `/api/adapter-drafts/${draftId}/functions/matchUrl/test`,
            payload: { url: 'https://m.happymh.com/manga/demo' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().data).toMatchObject({
            ok: true,
            adapterId: draftId,
            resultSummary: {
                matched: true,
                draftId,
                baseAdapterId: 'happymh',
            },
        });
}

const ADAPTER_DRAFT_ROUTES_EXECUTES_GENERATED_TYPE_SCRIPT_IMPLEMENTATION_DRAFTS_WITHOUT_REGISTERING_THEM_1_SOURCE = `
import { AdapterBase, CommonCapability, VerificationCapability, MetadataCapability, ChapterImagesCapability } from '../../base';
import type { ChapterInfo } from '@comiccrawler/shared';

export class GeneratedDemoAdapter extends AdapterBase {
  readonly id = 'generated-demo';
  readonly name = 'Generated Demo';
  readonly domains = ['generated.test'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = { verification: true, metadata: true, chapterImages: true };
  readonly common = new GeneratedCommon(this);
  readonly verification = new GeneratedVerification(this);
  readonly metadata = new GeneratedMetadata(this);
  readonly chapterImages = new GeneratedImages(this);
}
class GeneratedCommon extends CommonCapability {
  matchUrl(url: string): boolean { return new URL(url).hostname === 'generated.test'; }
}
class GeneratedVerification extends VerificationCapability {}
class GeneratedMetadata extends MetadataCapability {
  extractTitle(): string { return 'Generated'; }
  extractChapterList(): ChapterInfo[] { return []; }
}
class GeneratedImages extends ChapterImagesCapability {
  extractChapterImageUrls(): string[] { return []; }
}
`;

async function AdapterDraftRoutesTestExecutesGeneratedTypeScriptImplementationDraftsWithoutRegisteringThem() {
    await withDraftApp(runGeneratedDraft);
}

async function runGeneratedDraft({ app, service }: DraftApp): Promise<void> {
        const draft = await service.createFromGeneratedImplementation({
            baseAdapterId: 'generated-demo',
            baseAdapterName: 'Generated Demo',
            content: ADAPTER_DRAFT_ROUTES_EXECUTES_GENERATED_TYPE_SCRIPT_IMPLEMENTATION_DRAFTS_WITHOUT_REGISTERING_THEM_1_SOURCE,
        });
        const response = await app.inject({
            method: 'POST',
            url: `/api/adapter-drafts/${draft.draft.draftId}/functions/matchUrl/test`,
            payload: { url: 'https://generated.test/manga/title' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().data).toMatchObject({ ok: true, adapterId: draft.draft.draftId,
          resultSummary: { matched: true, draftId: draft.draft.draftId,
            baseAdapterId: 'generated-demo' } });
}

async function AdapterDraftRoutesTestCreatesAReadEditDraftCopyForAllowlistedProjectSource() {
    await withDraftApp(runReadEditDraft);
}

async function runReadEditDraft({ app, userPath }: DraftApp): Promise<void> {
        const created = await app.inject({ method: 'POST', url: '/api/adapters/happymh/drafts' });
        expect(created.statusCode).toBe(200);
        const draftId = created.json().data.draft.draftId as string;
        expect(created.json().data).toMatchObject({
            draft: {
                baseAdapterId: 'happymh',
                sourceKind: 'project-source',
                language: 'typescript',
            },
        });
        expect(created.json().data.content).toContain('class HappyMhAdapter');
        expect(await readFile(join(userPath, 'adapter-drafts', draftId, 'implementation.ts'), 'utf-8')).toContain('class HappyMhAdapter');
}
