import { describe, it, expect, beforeEach } from '@jest/globals';
import { DedupChecker } from '../../../src/image/dedup';

let checker: DedupChecker;

describe('DedupChecker', () => {
  DedupCheckerTestGroup1();
});

function DedupCheckerTestGroup1(): void {
  beforeEach(DedupCheckerTestScenario1);
  it('should detect URL duplicates', DedupCheckerTestShouldDetectURLDuplicates);
  it('should detect hash duplicates', DedupCheckerTestShouldDetectHashDuplicates);
  it('should register entries correctly', DedupCheckerTestShouldRegisterEntriesCorrectly);
  it('should track stats correctly', DedupCheckerTestShouldTrackStatsCorrectly);
  it('should clear all entries', DedupCheckerTestShouldClearAllEntries);
  it('should register with buffer and compute hash', DedupCheckerTestShouldRegisterWithBufferAndComputeHash);
}

function DedupCheckerTestScenario1() {
    checker = new DedupChecker();
}

async function DedupCheckerTestShouldDetectURLDuplicates() {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');
    const result = await checker.check('https://example.com/1.jpg');
    expect(result.isDuplicate).toBe(true);
    expect(result.existingPath).toBe('/path/1.jpg');
}

async function DedupCheckerTestShouldDetectHashDuplicates() {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');
    const result = await checker.check('https://example.com/2.jpg');
    expect(result.isDuplicate).toBe(false);
    const buffer = Buffer.from('test');
    const result2 = await checker.check('https://example.com/2.jpg', buffer);
    expect(result2.isDuplicate).toBe(false);
}

async function DedupCheckerTestShouldRegisterEntriesCorrectly() {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');
    const entry = checker.getEntry('https://example.com/1.jpg');
    expect(entry).toBeDefined();
    expect(entry?.url).toBe('https://example.com/1.jpg');
    expect(entry?.path).toBe('/path/1.jpg');
}

async function DedupCheckerTestShouldTrackStatsCorrectly() {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');
    await checker.register('https://example.com/2.jpg', 'hash2', '/path/2.jpg');
    const stats = checker.getStats();
    expect(stats.totalUnique).toBe(2);
    expect(stats.urlIndexed).toBe(2);
    expect(stats.hashIndexed).toBe(2);
}

async function DedupCheckerTestShouldClearAllEntries() {
    await checker.register('https://example.com/1.jpg', 'hash1', '/path/1.jpg');
    checker.clear();
    const stats = checker.getStats();
    expect(stats.totalUnique).toBe(0);
    const result = await checker.check('https://example.com/1.jpg');
    expect(result.isDuplicate).toBe(false);
}

async function DedupCheckerTestShouldRegisterWithBufferAndComputeHash() {
    const buffer = Buffer.from('test image data');
    await checker.registerWithBuffer('https://example.com/1.jpg', buffer, '/path/1.jpg');
    const entry = checker.getEntry('https://example.com/1.jpg');
    expect(entry).toBeDefined();
    expect(entry?.hash).toBeTruthy();
}
