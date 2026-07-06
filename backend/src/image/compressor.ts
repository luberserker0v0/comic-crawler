import { promises as fs } from 'node:fs';
import { ComicError, ErrorType } from '../error/types';

export interface CompressOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export class ImageCompressor {
  async compress(inputPath: string, outputPath: string, options?: CompressOptions): Promise<string> {
    const quality = options?.quality ?? 80;

    if (quality < 1 || quality > 100) {
      throw new ComicError(
        'Quality must be between 1 and 100',
        ErrorType.VALIDATION_ERROR
      );
    }

    const buffer = await fs.readFile(inputPath);

    await fs.writeFile(outputPath, buffer);

    return outputPath;
  }

  async compressBatch(files: Array<{ input: string; output: string }>, options?: CompressOptions): Promise<string[]> {
    const results: string[] = [];

    for (const file of files) {
      try {
        const result = await this.compress(file.input, file.output, options);
        results.push(result);
      } catch {
        results.push(file.input);
      }
    }

    return results;
  }

  async getCompressionRatio(originalPath: string, compressedPath: string): Promise<number> {
    const [originalStat, compressedStat] = await Promise.all([
      fs.stat(originalPath),
      fs.stat(compressedPath),
    ]);

    if (originalStat.size === 0) return 0;

    return Math.round((1 - compressedStat.size / originalStat.size) * 100);
  }
}
