import { EventEmitter } from 'node:events';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { trackRequestCancellation } from '../../../src/server/request-cancellation';

describe('request cancellation', () => {
  it('aborts when the response closes before completion', () => {
    const fixture = createFixture(false);
    const cancellation = trackRequestCancellation(fixture.request, fixture.reply);
    fixture.replyRaw.emit('close');
    expect(cancellation.signal.aborted).toBe(true);
    cancellation.dispose();
  });

  it('ignores a normal completed response close', () => {
    const fixture = createFixture(true);
    const cancellation = trackRequestCancellation(fixture.request, fixture.reply);
    fixture.replyRaw.emit('close');
    expect(cancellation.signal.aborted).toBe(false);
    cancellation.dispose();
  });
});

function createFixture(writableEnded: boolean) {
  const requestRaw = Object.assign(new EventEmitter(), { aborted: false });
  const replyRaw = Object.assign(new EventEmitter(), { writableEnded });
  return { requestRaw, replyRaw,
    request: { raw: requestRaw } as unknown as FastifyRequest,
    reply: { raw: replyRaw } as unknown as FastifyReply };
}
