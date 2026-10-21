import { fetchSafeHtml } from '../../../src/selector-discovery/safe-fetch';

const previousAllowPrivateHosts = process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS;

describe('fetchSafeHtml rendered-page boundary', () => {
  fetchSafeHtmlRenderedPageBoundaryTestGroup1();
});

function fetchSafeHtmlRenderedPageBoundaryTestGroup1(): void {
  beforeAll(fetchSafeHtmlRenderedPageBoundaryTestScenario1);
  afterAll(fetchSafeHtmlRenderedPageBoundaryTestScenario2);
  it('uses an injected Browser Worker renderer and preserves the final page URL', fetchSafeHtmlRenderedPageBoundaryTestUsesAnInjectedBrowserWorkerRendererAndPreservesTheFinalPageURL);
}

function fetchSafeHtmlRenderedPageBoundaryTestScenario1() {
    process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS = 'true';
}

function fetchSafeHtmlRenderedPageBoundaryTestScenario2() {
    if (previousAllowPrivateHosts === undefined)
        delete process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS;
    else
        process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS = previousAllowPrivateHosts;
}

async function fetchSafeHtmlRenderedPageBoundaryTestUsesAnInjectedBrowserWorkerRendererAndPreservesTheFinalPageURL() {
    const renderPage = jest.fn(async () => ({
        url: 'http://127.0.0.1/final',
        html: '<html><main>rendered chapter</main></html>',
    }));
    await expect(fetchSafeHtml('http://127.0.0.1/start', {
        renderFirst: true,
        timeoutMs: 1234,
        renderPage,
    })).resolves.toMatchObject({
        url: 'http://127.0.0.1/start',
        finalUrl: 'http://127.0.0.1/final',
        html: '<html><main>rendered chapter</main></html>',
        contentType: 'text/html; rendered=browser-worker',
    });
    expect(renderPage).toHaveBeenCalledWith('http://127.0.0.1/start', { timeoutMs: 1234 });
}
