import { describe, it, expect, beforeEach } from '@jest/globals';
import { DedupChecker } from '../../../src/image/dedup';

describe('DedupChecker', () => {
  let checker: DedupChecker;

  beforeEach(() => {
    checker = new DedupChecker();
  });

  it('should detect URL duplicates', async () => {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');

    const result = await checker.check('https://example.com/1.jpg');
    expect(result.isDuplicate).toBe(true);
    expect(result.existingPath).toBe('/path/1.jpg');
  });

  it('should detect hash duplicates', async () => {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');

    const result = await checker.check('https://example.com/2.jpg');
    expect(result.isDuplicate).toBe(false);

    const buffer = Buffer.from('test');
    const result2 = await checker.check('https://example.com/2.jpg', buffer);
    expect(result2.isDuplicate).toBe(false);
  });

  it('should register entries correctly', async () => {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');

    const entry = checker.getEntry('https://example.com/1.jpg');
    expect(entry).toBeDefined();
    expect(entry?.url).toBe('https://example.com/1.jpg');
    expect(entry?.path).toBe('/path/1.jpg');
  });

  it('should track stats correctly', async () => {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');
    await checker.register('https://example.com/2.jpg', 'hash2', '/path/2.jpg');

    const stats = checker.getStats();
    expect(stats.totalUnique).toBe(2);
    expect(stats.urlIndexed).toBe(2);
    expect(stats.hashIndexed).toBe(2);
  });

  it('should clear all entries', async () => {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');
    checker.clear();

    const stats = checker.getStats();
    expect(stats.totalUnique).toBe(0);

    const result = await checker.check('https://example.com/1.jpg');
    expect(result.isDuplicate).toBe(false);
  });

  it('should register with buffer and compute hash', async () => {
    const buffer = Buffer.from('test image data');
    await checker.registerWithBuffer('https://example.com/1.jpg', buffer, '/path/1.jpg');

    const entry = checker.getEntry('https://example.com/1.jpg');
    expect(entry).toBeDefined();
    expect(entry?.hash).toBeTruthy();
  });
});
