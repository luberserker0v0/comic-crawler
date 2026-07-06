import { promises as fs } from 'node:fs';
import { ComicError, ErrorType } from '../error/types';

export type ImageFormat = 'jpg' | 'png' | 'webp' | 'original';

export interface ConvertOptions {
  format: ImageFormat;
  quality?: number;
}

export class ImageConverter {
  private supportedFormats = new Set(['jpg', 'png', 'webp']);

  async convert(inputPath: string, outputPath: string, options: ConvertOptions): Promise<string> {
    if (options.format === 'original') {
      return inputPath;
    }

    if (!this.supportedFormats.has(options.format)) {
      throw new ComicError(
        `Unsupported format: ${options.format}`,
        ErrorType.VALIDATION_ERROR
      );
    }

    const buffer = await fs.readFile(inputPath);
    const currentFormat = this.detectFormat(buffer);

    if (currentFormat === options.format) {
      return inputPath;
    }

    await fs.writeFile(outputPath, buffer);
    return outputPath;
  }

  async convertBatch(files: Array<{ input: string; output: string }>, options: ConvertOptions): Promise<string[]> {
    const results: string[] = [];

    for (const file of files) {
      try {
        const result = await this.convert(file.input, file.output, options);
        results.push(result);
      } catch {
        results.push(file.input);
      }
    }

    return results;
  }

  private detectFormat(buffer: Buffer): string {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'webp';
    return 'unknown';
  }
}
