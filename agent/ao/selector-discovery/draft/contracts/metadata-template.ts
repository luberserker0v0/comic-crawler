import type { ChapterInfo } from '@comiccrawler/shared';
import { MetadataCapability } from '../../base';

class ExampleMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific title extraction from task.md evidence.');
  }

  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific chapter list extraction from task.md evidence.');
  }
}
