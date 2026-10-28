import type { FastifyReply, FastifyRequest } from 'fastify';

export interface RequestCancellation {
  signal: AbortSignal;
  dispose(): void;
}

export function trackRequestCancellation(
  request: FastifyRequest, reply: FastifyReply
): RequestCancellation {
  const controller = new AbortController();
  const abort = () => abortRequest(controller);
  const close = () => {
    if (!reply.raw.writableEnded) abort();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', close);
  if (request.raw.aborted) abort();
  return { signal: controller.signal, dispose: () => {
    request.raw.off('aborted', abort);
    reply.raw.off('close', close);
  } };
}

function abortRequest(controller: AbortController): void {
  if (controller.signal.aborted) return;
  controller.abort(new DOMException('HTTP request was cancelled.', 'AbortError'));
}
