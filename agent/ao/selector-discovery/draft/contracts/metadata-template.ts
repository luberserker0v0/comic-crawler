import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability } from '../../base';

class ExampleMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific title extraction from task.md evidence.');
  }

  extractAuthor(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific author extraction from task.md evidence.');
  }

  extractDescription(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific description extraction from task.md evidence.');
  }

  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific cover URL extraction from task.md evidence.');
  }

  extractTags(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific tag extraction from task.md evidence.');
  }

  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific status extraction from task.md evidence.');
  }

  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific chapter list extraction from task.md evidence.');
  }
}
