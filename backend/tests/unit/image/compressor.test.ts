import { describe, it, expect, beforeEach } from '@jest/globals';
import { ImageCompressor } from '../../../src/image/compressor';

describe('ImageCompressor', () => {
  let compressor: ImageCompressor;

  beforeEach(() => {
    compressor = new ImageCompressor();
  });

  it('should throw on invalid quality', async () => {
    await expect(
      compressor.compress('/path/test.jpg', '/path/compressed.jpg', { quality: 0 })
    ).rejects.toThrow();

    await expect(
      compressor.compress('/path/test.jpg', '/path/compressed.jpg', { quality: 101 })
    ).rejects.toThrow();
  });
});
