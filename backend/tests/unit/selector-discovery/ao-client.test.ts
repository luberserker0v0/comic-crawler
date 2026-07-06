import { describe, expect, it, jest } from '@jest/globals';

const fetchMock = jest.fn(async (_url: unknown, _init: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ messageId: 'm1', text: 'ok' }),
}));

jest.mock('undici', () => ({
  fetch: (url: unknown, init: unknown) => fetchMock(url, init),
}));

describe('AoClient', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (_url: unknown, _init: unknown) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ messageId: 'm1', text: 'ok' }),
    }));
  });

  it('sends model and primary agent in the message API body', async () => {
    const { AoClient } = await import('../../../src/selector-discovery/ao-client');
    const client = new AoClient('http://127.0.0.1:32768');

    await client.message(
      'conv-1',
      '# Task',
      'my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive',
      'selector-discovery'
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32768/api/conversations/conv-1/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: '# Task',
          model: 'my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive',
          agent: 'selector-discovery',
        }),
      })
    );
  });

  it('polls the conversation status API until AO is ready', async () => {
    fetchMock
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'conv-1', status: 'running', ready: false }),
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'conv-1', status: 'running', ready: true, sessionId: 'ses_1' }),
      }));

    const { AoClient } = await import('../../../src/selector-discovery/ao-client');
    const client = new AoClient('http://127.0.0.1:32768');
    const status = await client.waitForReady('conv-1', 5000);

    expect(status.sessionId).toBe('ses_1');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:32768/api/conversations/conv-1', undefined);
  });
});
