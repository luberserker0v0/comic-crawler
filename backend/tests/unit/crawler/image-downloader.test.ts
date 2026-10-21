import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ImageDownloader } from '../../../src/crawler/image-downloader';

const TEST_ROOT = join(__dirname, '__tmp__', 'image-downloader');

function createBody(chunks: Array<string | Buffer>): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
    },
  };
}

let downloader: ImageDownloader;

describe('ImageDownloader', () => {
  ImageDownloaderTestGroup1();
});

function ImageDownloaderTestGroup1(): void {
  beforeEach(ImageDownloaderTestScenario1);
  afterEach(ImageDownloaderTestScenario2);
  it('should append the source extension when the naming template omits it', ImageDownloaderTestShouldAppendTheSourceExtensionWhenTheNamingTemplateOmitsIt);
  it('should avoid duplicating the extension when the template already includes {ext}', ImageDownloaderTestShouldAvoidDuplicatingTheExtensionWhenTheTemplateAlreadyIncludesExt);
  it('should skip downloading when the target file already exists', ImageDownloaderTestShouldSkipDownloadingWhenTheTargetFileAlreadyExists);
  it('should resume from a partial file using HTTP range requests', ImageDownloaderTestShouldResumeFromAPartialFileUsingHTTPRangeRequests);
  it('uses the image origin as the default Referer', ImageDownloaderTestUsesTheImageOriginAsTheDefaultReferer);
}

async function ImageDownloaderTestScenario1() {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });
    downloader = new ImageDownloader();
}

async function ImageDownloaderTestScenario2() {
    await downloader.dispose();
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
}

function ImageDownloaderTestShouldAppendTheSourceExtensionWhenTheNamingTemplateOmitsIt() {
    const filename = (downloader as any).generateFilename({ url: 'https://example.com/page/image-1.png', index: 1 }, { outputDir: './downloads' });
    expect(filename).toBe('001.png');
}

function ImageDownloaderTestShouldAvoidDuplicatingTheExtensionWhenTheTemplateAlreadyIncludesExt() {
    const filename = (downloader as any).generateFilename({ url: 'https://example.com/page/image-1.webp', index: 2 }, { outputDir: './downloads', namingTemplate: '{index}{ext}' });
    expect(filename).toBe('002.webp');
}

async function ImageDownloaderTestShouldSkipDownloadingWhenTheTargetFileAlreadyExists() {
    const existingPath = join(TEST_ROOT, '001.jpg');
    await fs.writeFile(existingPath, 'already-downloaded');
    const requestSpy = jest.fn();
    await downloader.dispose();
    (downloader as any).client = { request: requestSpy, close: jest.fn(async () => { }) };
    const result = await downloader.download({ url: 'https://example.com/image-1.jpg', index: 1 }, { outputDir: TEST_ROOT });
    expect(requestSpy).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.size).toBe(Buffer.byteLength('already-downloaded'));
}

async function ImageDownloaderTestShouldResumeFromAPartialFileUsingHTTPRangeRequests() {
    const partialPath = join(TEST_ROOT, '001.jpg.part');
    await fs.writeFile(partialPath, 'partial-');
    const requestSpy = jest.fn(async (options: {
        headers: Record<string, string>;
    }) => {
        expect(options.headers.Range).toBe(`bytes=${Buffer.byteLength('partial-')}-`);
        return {
            statusCode: 206,
            body: createBody(['remaining']),
        };
    });
    await downloader.dispose();
    (downloader as any).client = { request: requestSpy, close: jest.fn(async () => { }) };
    const result = await downloader.download({ url: 'https://example.com/image-1.jpg', index: 1 }, { outputDir: TEST_ROOT });
    const content = await fs.readFile(join(TEST_ROOT, '001.jpg'), 'utf-8');
    expect(content).toBe('partial-remaining');
    expect(result.resumed).toBe(true);
    expect(result.size).toBe(Buffer.byteLength('partial-remaining'));
}

async function ImageDownloaderTestUsesTheImageOriginAsTheDefaultReferer() {
    const requestSpy = jest.fn(async (options: {
        headers: Record<string, string>;
    }) => {
        expect(options.headers.Referer).toBe('https://ruicdn.happymh.com');
        return {
            statusCode: 200,
            body: createBody(['image-bytes']),
        };
    });
    await downloader.dispose();
    (downloader as any).client = { request: requestSpy, close: jest.fn(async () => { }) };
    await downloader.download({ url: 'https://ruicdn.happymh.com/hash/page.jpg?q=99', index: 1 }, { outputDir: TEST_ROOT });
    expect(requestSpy).toHaveBeenCalled();
}
