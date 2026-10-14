import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { JsonFileStore } from '../../../src/storage/json-store';

const TEST_DIR = join(__dirname, '__tmp__', 'json-store');

describe('JsonFileStore', () => {
  let store: JsonFileStore;

  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    store = new JsonFileStore({ basePath: TEST_DIR, flushInterval: 50 });
    await store.initialize();
  });

  afterEach(async () => {
    await store.dispose();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should write and read data', async () => {
    const data = { title: 'Test Comic', chapters: 10 };
    await store.write('comic1', data);

    const result = await store.read<typeof data>('comic1');
    expect(result).toEqual(data);
  });

  it('should return null for non-existent keys', async () => {
    const result = await store.read('non-existent');
    expect(result).toBeNull();
  });

  it('should delete data', async () => {
    await store.write('comic1', { title: 'Test' });
    await store.delete('comic1');

    const result = await store.read('comic1');
    expect(result).toBeNull();
  });

  it('should list all keys', async () => {
    await store.write('comic1', { title: 'A' });
    await store.write('comic2', { title: 'B' });
    await store.dispose(); // Ensure flush

    const keys = await store.list();
    expect(keys).toContain('comic1');
    expect(keys).toContain('comic2');
    expect(keys).toHaveLength(2);
  });

  it('should check existence', async () => {
    await store.write('comic1', { title: 'Test' });
    await store.dispose();

    expect(await store.exists('comic1')).toBe(true);
    expect(await store.exists('non-existent')).toBe(false);
  });

  it('should store hierarchical keys without rewriting them', async () => {
    await store.write('comics/1', { title: 'Test' });
    await expect(store.read('comics/1')).resolves.toEqual({ title: 'Test' });
    await expect(store.list()).resolves.toContain('comics/1');
  });

  it('should reject invalid key characters and traversal', async () => {
    await expect(store.write('comic:1', { title: 'Test' })).rejects.toThrow(/invalid key/i);
    await expect(store.write('../comic', { title: 'Test' })).rejects.toThrow(/invalid key/i);
  });

  it('should throw for persistently invalid JSON', async () => {
    await fs.writeFile(join(TEST_DIR, 'broken.json'), '{not json', 'utf-8');
    await expect(store.read('broken')).rejects.toThrow(/invalid JSON/i);
  });

  it('should flush automatically after interval', async () => {
    await store.write('comic1', { title: 'Test' });

    // Wait for flush interval + buffer
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Read directly from file to verify flush
    const content = await fs.readFile(join(TEST_DIR, 'comic1.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual({ title: 'Test' });
  });
});
