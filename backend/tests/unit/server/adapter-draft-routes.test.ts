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

describe('Adapter draft routes', () => {
  async function createApp() {
    const userPath = await mkdtemp(join(tmpdir(), 'comiccrawler-drafts-user-'));
    const registry = new AdapterRegistry();
    registry.register(new HappyMhAdapter());
    registry.register(new DynamicSiteAdapter({
      adapterId: 'dynamic-demo',
      name: 'Dynamic Demo',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/read/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'disc-1',
      promotedAt: '2026-07-09T00:00:00.000Z',
    }));
    const service = new AdapterDraftService(userPath, registry);
    const app = fastify();
    setupAdapterDraftRoutes(app, service);
    return { app, userPath, service };
  }

  it('creates, reads, saves, resets, and discards a dynamic manifest draft under user data', async () => {
    const { app, userPath } = await createApp();
    try {
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
      expect(list.json().data.drafts).toEqual(expect.arrayContaining([
        expect.objectContaining({ draftId, baseAdapterId: 'dynamic-demo' }),
      ]));

      const discarded = await app.inject({ method: 'DELETE', url: `/api/adapter-drafts/${draftId}` });
      expect(discarded.statusCode).toBe(200);
      const afterDiscard = await app.inject({ method: 'GET', url: `/api/adapter-drafts/${draftId}` });
      expect(afterDiscard.statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(userPath, { recursive: true, force: true });
    }
  });

  it('tests dynamic manifest drafts without registering them as active adapters', async () => {
    const { app, userPath } = await createApp();
    try {
      const created = await app.inject({ method: 'POST', url: '/api/adapters/dynamic-demo/drafts' });
      const draftId = created.json().data.draft.draftId as string;
      const manifest = JSON.parse(created.json().data.content);
      manifest.urlPatterns = ['https://example.com/draft-read/*'];
      await app.inject({
        method: 'PUT',
        url: `/api/adapter-drafts/${draftId}/content`,
        payload: { content: JSON.stringify(manifest, null, 2) },
      });

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
      expect(matched.json().data).toMatchObject({
        ok: true,
        adapterId: draftId,
        resultSummary: {
          matched: true,
          draftId,
          baseAdapterId: 'dynamic-demo',
        },
      });
      expect(unmatched.statusCode).toBe(200);
      expect(unmatched.json().data.resultSummary.matched).toBe(false);
    } finally {
      await app.close();
      await rm(userPath, { recursive: true, force: true });
    }
  });

  it('does not execute project-source TypeScript drafts', async () => {
    const { app, userPath } = await createApp();
    try {
      const created = await app.inject({ method: 'POST', url: '/api/adapters/happymh/drafts' });
      const draftId = created.json().data.draft.draftId as string;

      const response = await app.inject({
        method: 'POST',
        url: `/api/adapter-drafts/${draftId}/functions/matchUrl/test`,
        payload: { url: 'https://m.happymh.com/manga/demo' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/project-source typescript drafts can be saved but not executed/i);
    } finally {
      await app.close();
      await rm(userPath, { recursive: true, force: true });
    }
  });

  it('executes generated TypeScript implementation drafts without registering them', async () => {
    const { app, userPath, service } = await createApp();
    try {
      const draft = await service.createFromGeneratedImplementation({
        baseAdapterId: 'generated-demo',
        baseAdapterName: 'Generated Demo',
        content: `
import { AdapterBase, CommonCapability, VerificationCapability, MetadataCapability, ChapterImagesCapability } from '../../base';
import type { ChapterInfo } from '@comiccrawler/shared';

export class GeneratedDemoAdapter extends AdapterBase {
  readonly id = 'generated-demo';
  readonly name = 'Generated Demo';
  readonly domains = ['generated.test'];
  readonly parseMode = 'static' as const;
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
`,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/adapter-drafts/${draft.draft.draftId}/functions/matchUrl/test`,
        payload: { url: 'https://generated.test/manga/title' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        ok: true,
        adapterId: draft.draft.draftId,
        resultSummary: {
          matched: true,
          draftId: draft.draft.draftId,
          baseAdapterId: 'generated-demo',
        },
      });
    } finally {
      await app.close();
      await rm(userPath, { recursive: true, force: true });
    }
  });

  it('creates a read/edit draft copy for allowlisted project source without executing it', async () => {
    const { app, userPath } = await createApp();
    try {
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
    } finally {
      await app.close();
      await rm(userPath, { recursive: true, force: true });
    }
  });
});
