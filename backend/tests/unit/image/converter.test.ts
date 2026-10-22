import { describe, it, expect, beforeEach } from '@jest/globals';
import { ImageConverter } from '../../../src/image/converter';

let converter: ImageConverter;

describe('ImageConverter', () => {
  ImageConverterTestGroup1();
});

function ImageConverterTestGroup1(): void {
  beforeEach(ImageConverterTestScenario1);
  it('should return original path for original format', ImageConverterTestShouldReturnOriginalPathForOriginalFormat);
  it('should throw on unsupported format', ImageConverterTestShouldThrowOnUnsupportedFormat);
  it('should detect jpg format', ImageConverterTestShouldDetectJpgFormat);
  it('should detect png format', ImageConverterTestShouldDetectPngFormat);
  it('should detect webp format', ImageConverterTestShouldDetectWebpFormat);
  it('should handle unknown format', ImageConverterTestShouldHandleUnknownFormat);
}

function ImageConverterTestScenario1() {
    converter = new ImageConverter();
}

async function ImageConverterTestShouldReturnOriginalPathForOriginalFormat() {
    const result = await converter.convert('/path/test.jpg', '/path/test.jpg', { format: 'original' });
    expect(result).toBe('/path/test.jpg');
}

async function ImageConverterTestShouldThrowOnUnsupportedFormat() {
    await expect(converter.convert('/path/test.jpg', '/path/test.bmp', { format: 'bmp' as any })).rejects.toThrow();
}

function ImageConverterTestShouldDetectJpgFormat() {
    const jpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const format = (converter as any).detectFormat(jpgBuffer);
    expect(format).toBe('jpg');
}

function ImageConverterTestShouldDetectPngFormat() {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const format = (converter as any).detectFormat(pngBuffer);
    expect(format).toBe('png');
}

function ImageConverterTestShouldDetectWebpFormat() {
    const webpBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    const format = (converter as any).detectFormat(webpBuffer);
    expect(format).toBe('webp');
}

function ImageConverterTestShouldHandleUnknownFormat() {
    const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const format = (converter as any).detectFormat(unknownBuffer);
    expect(format).toBe('unknown');
}
