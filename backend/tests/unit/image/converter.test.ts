import { describe, it, expect, beforeEach } from '@jest/globals';
import { ImageConverter } from '../../../src/image/converter';

describe('ImageConverter', () => {
  let converter: ImageConverter;

  beforeEach(() => {
    converter = new ImageConverter();
  });

  it('should return original path for original format', async () => {
    const result = await converter.convert('/path/test.jpg', '/path/test.jpg', { format: 'original' });
    expect(result).toBe('/path/test.jpg');
  });

  it('should throw on unsupported format', async () => {
    await expect(
      converter.convert('/path/test.jpg', '/path/test.bmp', { format: 'bmp' as any })
    ).rejects.toThrow();
  });

  it('should detect jpg format', () => {
    const jpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const format = (converter as any).detectFormat(jpgBuffer);
    expect(format).toBe('jpg');
  });

  it('should detect png format', () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const format = (converter as any).detectFormat(pngBuffer);
    expect(format).toBe('png');
  });

  it('should detect webp format', () => {
    const webpBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    const format = (converter as any).detectFormat(webpBuffer);
    expect(format).toBe('webp');
  });

  it('should handle unknown format', () => {
    const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const format = (converter as any).detectFormat(unknownBuffer);
    expect(format).toBe('unknown');
  });
});
