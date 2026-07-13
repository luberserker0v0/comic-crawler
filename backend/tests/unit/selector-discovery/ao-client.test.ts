import { afterEach, describe, expect, it } from '@jest/globals';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { AoClient } from '../../../src/selector-discovery/ao-client';

describe('AoClient', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('sends model and primary agent in message requests', async () => {
    let capturedBody: any;
    const baseUrl = await startFakeAoServer(async (request, body) => {
      if (request.url === '/api/conversations/conv-1/message') {
        capturedBody = JSON.parse(body);
        return { status: 200, body: { text: 'ok' } };
      }
      return { status: 404, body: { error: 'not found' } };
    });

    const client = new AoClient(baseUrl);
    await client.message('conv-1', '# Task', 'my_local_lmstudio/demo-model', 'selector-discovery');

    expect(capturedBody).toEqual({
      text: '# Task',
      model: 'my_local_lmstudio/demo-model',
      agent: 'selector-discovery',
    });
  });

  it('reads conversation status through the AO status endpoint', async () => {
    const baseUrl = await startFakeAoServer(async (request) => {
      if (request.url === '/api/conversations/conv-1') {
        return { status: 200, body: { id: 'conv-1', ready: true, sessionId: 'session-1' } };
      }
      return { status: 404, body: { error: 'not found' } };
    });

    const client = new AoClient(baseUrl);
    await expect(client.getConversationStatus('conv-1')).resolves.toMatchObject({
      id: 'conv-1',
      ready: true,
      sessionId: 'session-1',
    });
  });

  async function startFakeAoServer(
    handler: (request: IncomingMessage, body: string) => Promise<{ status: number; body: unknown }>
  ): Promise<string> {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk.toString();
      });
      request.on('end', async () => {
        const result = await handler(request, body);
        response.statusCode = result.status;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(result.body));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }
});
