import type { ChapterImagesResponse } from '@comiccrawler/shared';
import { ChapterImageManifestConflictError, ChapterImageManifestService } from
  '../../../src/adapter/chapter-image-manifest';
import type { IStorage } from '../../../src/storage/types';

class MemoryStorage implements IStorage {
  readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return (this.values.get(key) as T | undefined) ?? null; }
  async write(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async list(): Promise<string[]> { return [...this.values.keys()]; }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}

describe('ChapterImageManifestService', () => {
  it('persists owner-scoped manifests across service restarts', testPersistenceAndOwnership);
  it('derives revisions from semantic manifest content', testSemanticRevision);
  it('resolves renewed signed URLs without exposing match keys', testRenewedUrlResolution);
  it('reports duplicate URL keys as ambiguous unless the batch disambiguates occurrences', testDuplicateResolution);
  it('requires adapterId when multiple manifests match one URL', testAdapterConflict);
});

async function testPersistenceAndOwnership(): Promise<void> {
  const storage = new MemoryStorage(), first = service(storage);
  const saved = await first.save('alice', response());
  const restarted = service(storage);
  await expect(restarted.get('alice', saved.chapter.id)).resolves.toEqual(saved);
  await expect(restarted.get('bob', saved.chapter.id)).resolves.toBeUndefined();
  await expect(restarted.resolve('alice', saved.chapter.canonicalUrl)).resolves.toEqual(saved);
}

async function testSemanticRevision(): Promise<void> {
  const storage = new MemoryStorage(), manifests = service(storage);
  const first = await manifests.save('alice', response());
  const same = await manifests.save('alice', response());
  const changed = await manifests.save('alice', response(['https://cdn.example/pages/2.jpg']));
  expect(same.revision).toBe(first.revision);
  expect(same.capturedAt).toBe(first.capturedAt);
  expect(changed.revision).not.toBe(first.revision);
}

async function testRenewedUrlResolution(): Promise<void> {
  const manifests = service(new MemoryStorage());
  const saved = await manifests.save('alice', response([
    'https://cdn-a.example/pages/1.jpg?width=1200&token=old',
  ]));
  const result = await manifests.resolvePages('alice', saved.chapter.id, [
    'https://cdn-b.example/pages/1.jpg?expires=99&width=1200&token=new',
  ], saved.revision);
  expect(saved.identityResolver).toEqual({ id: 'normalized-url', version: 1 });
  expect(result?.matches).toEqual([{ url: expect.any(String), status: 'matched',
    pageId: 'page-1', orderIndex: 0 }]);
  expect(JSON.stringify(result)).not.toContain('matchKey');
}

async function testDuplicateResolution(): Promise<void> {
  const manifests = service(new MemoryStorage());
  const saved = await manifests.save('alice', response([
    'https://cdn.example/pages/shared.jpg?token=1', 'https://cdn.example/pages/shared.jpg?token=2',
  ]));
  const one = await manifests.resolvePages('alice', saved.chapter.id,
    ['https://other.example/pages/shared.jpg?token=3']);
  expect(one?.matches[0]).toMatchObject({ status: 'ambiguous' });
  const two = await manifests.resolvePages('alice', saved.chapter.id,
    ['https://other.example/pages/shared.jpg?token=3', 'https://other.example/pages/shared.jpg?token=4']);
  expect(two?.matches.map((match) => match.status === 'matched' ? match.pageId : undefined))
    .toEqual(['page-1', 'page-2']);
}

async function testAdapterConflict(): Promise<void> {
  const manifests = service(new MemoryStorage());
  await manifests.save('alice', response());
  await manifests.save('alice', response(undefined, 'other-adapter', 'chapter-other'));
  await expect(manifests.resolve('alice', 'https://reader.example/chapter/1'))
    .rejects.toBeInstanceOf(ChapterImageManifestConflictError);
  await expect(manifests.resolve('alice', 'https://reader.example/chapter/1', 'demo'))
    .resolves.toMatchObject({ adapterId: 'demo' });
}

function service(storage: IStorage): ChapterImageManifestService {
  return new ChapterImageManifestService(storage, () => new Date('2026-10-29T00:00:00.000Z'));
}

function response(
  urls = ['https://cdn.example/pages/1.jpg'], adapterId = 'demo', chapterId = 'chapter-1'
): ChapterImagesResponse {
  const images = urls.map((url, orderIndex) => ({ id: `page-${orderIndex + 1}`, orderIndex, url }));
  return { adapterId, chapterUrl: 'https://reader.example/chapter/1?token=request',
    chapter: { id: chapterId, canonicalUrl: 'https://reader.example/chapter/1',
      stability: 'deterministic', identitySource: 'normalized-url' },
    imageUrlCount: urls.length, imageUrls: urls, images, domSource: 'rendered', durationMs: 1,
    renderContext: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } };
}
