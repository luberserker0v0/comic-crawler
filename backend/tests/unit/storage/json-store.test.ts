import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { JsonFileStore } from '../../../src/storage/json-store';

const TEST_DIR = join(__dirname, '__tmp__');

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

  it('should handle special characters in keys', async () => {
    const key = 'comic:1/2';
    await store.write(key, { title: 'Test' });
    await store.dispose();

    const result = await store.read(key);
    expect(result).toEqual({ title: 'Test' });
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
