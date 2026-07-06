import type { ComicMetadata, ImageInfo, SearchResult, SearchOptions, ComicUpdate } from '@comiccrawler/shared';
import type { IExtractionStrategy, ExtractionContext } from '../types';

export class WebSocketExtractionStrategy implements IExtractionStrategy {
  readonly name = 'websocket';
  readonly parseMode = 'dynamic' as const;

  async extractMetadata(_context: ExtractionContext): Promise<ComicMetadata> {
    throw new Error('WebSocketExtractionStrategy requires WebSocket listener setup');
  }

  async extractChapters(_context: ExtractionContext): Promise<Array<{ id: string; title: string; url: string }>> {
    throw new Error('WebSocketExtractionStrategy requires WebSocket listener setup');
  }

  async extractImages(_context: ExtractionContext): Promise<ImageInfo[]> {
    throw new Error('WebSocketExtractionStrategy requires WebSocket listener setup');
  }

  async search?(_query: string, _options: SearchOptions, _context: ExtractionContext): Promise<SearchResult[]> {
    return [];
  }

  async fetchUpdates?(_since: Date, _context: ExtractionContext): Promise<ComicUpdate[]> {
    return [];
  }

  async validate(_context: ExtractionContext): Promise<boolean> {
    return false;
  }
}
