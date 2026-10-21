import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { JsonFileStore } from '../../../src/storage/json-store';

const TEST_DIR = join(__dirname, '__tmp__', 'json-store');

let store: JsonFileStore;

describe('JsonFileStore', () => {
  JsonFileStoreTestGroup1();
  JsonFileStoreTestGroup2();
});

function JsonFileStoreTestGroup1(): void {
  beforeEach(JsonFileStoreTestScenario1);
  afterEach(JsonFileStoreTestScenario2);
  it('should write and read data', JsonFileStoreTestShouldWriteAndReadData);
  it('should return null for non-existent keys', JsonFileStoreTestShouldReturnNullForNonExistentKeys);
  it('should delete data', JsonFileStoreTestShouldDeleteData);
  it('should list all keys', JsonFileStoreTestShouldListAllKeys);
  it('should check existence', JsonFileStoreTestShouldCheckExistence);
  it('should store hierarchical keys without rewriting them', JsonFileStoreTestShouldStoreHierarchicalKeysWithoutRewritingThem);
  it('should reject invalid key characters and traversal', JsonFileStoreTestShouldRejectInvalidKeyCharactersAndTraversal);
  it('should throw for persistently invalid JSON', JsonFileStoreTestShouldThrowForPersistentlyInvalidJSON);
}

function JsonFileStoreTestGroup2(): void {
  it('should flush automatically after interval', JsonFileStoreTestShouldFlushAutomaticallyAfterInterval);
  it('should wait for an in-flight flush before disposal completes', JsonFileStoreTestShouldWaitForAnInFlightFlushBeforeDisposalCompletes);
}

async function JsonFileStoreTestScenario1() {
    await fs.mkdir(TEST_DIR, { recursive: true });
    store = new JsonFileStore({ basePath: TEST_DIR, flushInterval: 50 });
    await store.initialize();
}

async function JsonFileStoreTestScenario2() {
    await store.dispose();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
}

async function JsonFileStoreTestShouldWriteAndReadData() {
    const data = { title: 'Test Comic', chapters: 10 };
    await store.write('comic1', data);
    const result = await store.read<typeof data>('comic1');
    expect(result).toEqual(data);
}

async function JsonFileStoreTestShouldReturnNullForNonExistentKeys() {
    const result = await store.read('non-existent');
    expect(result).toBeNull();
}

async function JsonFileStoreTestShouldDeleteData() {
    await store.write('comic1', { title: 'Test' });
    await store.delete('comic1');
    const result = await store.read('comic1');
    expect(result).toBeNull();
}

async function JsonFileStoreTestShouldListAllKeys() {
    await store.write('comic1', { title: 'A' });
    await store.write('comic2', { title: 'B' });
    await store.dispose(); // Ensure flush
    const keys = await store.list();
    expect(keys).toContain('comic1');
    expect(keys).toContain('comic2');
    expect(keys).toHaveLength(2);
}

async function JsonFileStoreTestShouldCheckExistence() {
    await store.write('comic1', { title: 'Test' });
    await store.dispose();
    expect(await store.exists('comic1')).toBe(true);
    expect(await store.exists('non-existent')).toBe(false);
}

async function JsonFileStoreTestShouldStoreHierarchicalKeysWithoutRewritingThem() {
    await store.write('comics/1', { title: 'Test' });
    await expect(store.read('comics/1')).resolves.toEqual({ title: 'Test' });
    await expect(store.list()).resolves.toContain('comics/1');
}

async function JsonFileStoreTestShouldRejectInvalidKeyCharactersAndTraversal() {
    await expect(store.write('comic:1', { title: 'Test' })).rejects.toThrow(/invalid key/i);
    await expect(store.write('../comic', { title: 'Test' })).rejects.toThrow(/invalid key/i);
}

async function JsonFileStoreTestShouldThrowForPersistentlyInvalidJSON() {
    await fs.writeFile(join(TEST_DIR, 'broken.json'), '{not json', 'utf-8');
    await expect(store.read('broken')).rejects.toThrow(/invalid JSON/i);
}

async function JsonFileStoreTestShouldFlushAutomaticallyAfterInterval() {
    await store.write('comic1', { title: 'Test' });
    // Wait for flush interval + buffer
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Read directly from file to verify flush
    const content = await fs.readFile(join(TEST_DIR, 'comic1.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual({ title: 'Test' });
}

async function JsonFileStoreTestShouldWaitForAnInFlightFlushBeforeDisposalCompletes() {
    const originalAtomicWrite = (store as any).atomicWriteFile.bind(store);
    const started = deferred();
    const released = deferred();
    jest.spyOn(store as any, 'atomicWriteFile').mockImplementation(async (...args: unknown[]) => {
        started.resolve();
        await released.promise;
        return originalAtomicWrite(...args);
    });
    (store as any).maxBufferSize = 1;
    const writePromise = store.write('in-flight', { title: 'Test' });
    await started.promise;
    const disposal = trackedDisposal();
    await Promise.resolve();
    expect(disposal.completed).toBe(false);
    released.resolve();
    await Promise.all([writePromise, disposal.promise]);
    expect(await store.read('in-flight')).toEqual({ title: 'Test' });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function trackedDisposal(): { promise: Promise<void>; completed: boolean } {
  const result = { promise: Promise.resolve(), completed: false };
  result.promise = store.dispose().then(() => { result.completed = true; });
  return result;
}
