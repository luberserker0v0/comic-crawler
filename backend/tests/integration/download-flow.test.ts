import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../src/events/bus';
import { JsonFileStore } from '../../src/storage/json-store';
import { AdapterRegistry } from '../../src/adapter/registry';
import { AdapterBase } from '../../src/adapter/base';
import type { ComicMetadata } from '../../../shared/types';

// NOTE: keep this scoped to our own subdirectory. afterEach removes it,
// and sibling integration tests run in parallel workers under the same
// parent __tmp__ dir (wiping it once flaked rest-only-flow with ENOENT).
const TEST_DIR = join(__dirname, '__tmp__', 'download-flow');

class MockAdapter extends AdapterBase {
  readonly id = 'mock';
  readonly name = 'Mock Adapter';
  readonly domains = ['mock.example.com'];
  readonly parseMode = 'playwright' as const;

  matchUrl(url: string): boolean {
    return url.includes('mock.example.com');
  }

  async loadDocument(url: string): Promise<unknown> {
    return url;
  }

  extractTitle(): string {
    return 'Mock Comic';
  }

  extractAuthor(): string {
    return 'Mock Author';
  }

  extractChapterList(): ComicMetadata['chapters'] {
    return [
      { id: 'ch-1', title: 'Chapter 1', url: 'https://mock.example.com/chapter/1' },
      { id: 'ch-2', title: 'Chapter 2', url: 'https://mock.example.com/chapter/2' },
    ];
  }

  extractChapterImageUrls(): string[] {
    return [
      'https://mock.example.com/img/1.jpg',
      'https://mock.example.com/img/2.jpg',
    ];
  }
}

let eventBus: EventBus;

let storage: JsonFileStore;

let registry: AdapterRegistry;

describe('Integration: Download Flow', () => {
  IntegrationDownloadFlowTestGroup1();
});

function IntegrationDownloadFlowTestGroup1(): void {
  beforeEach(IntegrationDownloadFlowTestScenario1);
  afterEach(IntegrationDownloadFlowTestScenario2);
  it('should register adapter and find by URL', IntegrationDownloadFlowTestShouldRegisterAdapterAndFindByURL);
}

async function IntegrationDownloadFlowTestScenario1() {
    await fs.mkdir(TEST_DIR, { recursive: true });
    eventBus = new EventBus();
    storage = new JsonFileStore({ basePath: TEST_DIR, flushInterval: 50 });
    await storage.initialize();
    registry = new AdapterRegistry(eventBus);
    registry.register(new MockAdapter());
}

async function IntegrationDownloadFlowTestScenario2() {
    await storage.dispose();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
}

function IntegrationDownloadFlowTestShouldRegisterAdapterAndFindByURL() {
    const adapter = registry.findByUrl('https://mock.example.com/comic/1');
    expect(adapter).toBeDefined();
    expect(adapter?.id).toBe('mock');
}
