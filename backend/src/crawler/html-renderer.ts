import type { BrowserConfig } from '@comiccrawler/shared';
import { assertNotAntiBotChallenge } from './anti-bot';
import { ComicError, ErrorType } from '../error/types';
import type { BrowserRenderService } from '../browser/browser-render-service';
import type { ReaderPreparationSelectors } from '@comiccrawler/browser-client-sdk';

export interface HtmlRenderOptions {
  reader?: ReaderPreparationSelectors;
}

export interface HtmlRenderer {
  render(url: string, options?: HtmlRenderOptions): Promise<string>;
  dispose(): Promise<void>;
}

export class GatewayHtmlRenderer implements HtmlRenderer {
  constructor(
    private readonly renderService: BrowserRenderService,
    private readonly getSessionId: () => string | undefined,
    private readonly browser: BrowserConfig
  ) {}

  async render(url: string, options?: HtmlRenderOptions): Promise<string> {
    const sessionId = this.getSessionId();
    if (!sessionId) {
      throw new ComicError('Browser Worker session is required for rendered DOM.', ErrorType.CONFIG_ERROR, false, {
        url,
      });
    }
    const page = await this.renderService.render(sessionId, url, {
      timeoutMs: this.browser.timeout,
      postLoadDelayMs: this.browser.postLoadDelayMs,
      reader: options?.reader,
    });
    assertNotAntiBotChallenge(page.html, page.url);
    return page.html;
  }

  async dispose(): Promise<void> {}
}
