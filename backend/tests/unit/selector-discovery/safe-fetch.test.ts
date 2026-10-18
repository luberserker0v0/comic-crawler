import { fetchSafeHtml } from '../../../src/selector-discovery/safe-fetch';

describe('fetchSafeHtml rendered-page boundary', () => {
  const previousAllowPrivateHosts = process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS;

  beforeAll(() => {
    process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS = 'true';
  });

  afterAll(() => {
    if (previousAllowPrivateHosts === undefined) delete process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS;
    else process.env.SELECTOR_DISCOVERY_ALLOW_PRIVATE_HOSTS = previousAllowPrivateHosts;
  });

  it('uses an injected Browser Worker renderer and preserves the final page URL', async () => {
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
  });
});
