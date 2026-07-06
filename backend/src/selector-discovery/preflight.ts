import type { ProviderDocument } from './types';
import { AoClient, type AoConversationStatus } from './ao-client';
import { SelectorDiscoveryBundleManager } from './bundle-manager';

export interface SelectorDiscoveryPreflightStep {
  name: 'load-bundle' | 'create-conversation' | 'upload-bundle' | 'start' | 'status' | 'session' | 'message' | 'cleanup';
  ok: boolean;
  detail?: unknown;
  error?: string;
}

export interface SelectorDiscoveryPreflightResult {
  ok: boolean;
  conversationId?: string;
  bundleHash?: string;
  status?: AoConversationStatus;
  steps: SelectorDiscoveryPreflightStep[];
}

export async function runSelectorDiscoveryPreflight(input: {
  aoBaseUrl: string;
  providerDocument: ProviderDocument;
  model: string;
  bundleManager?: SelectorDiscoveryBundleManager;
}): Promise<SelectorDiscoveryPreflightResult> {
  const steps: SelectorDiscoveryPreflightStep[] = [];
  const client = new AoClient(input.aoBaseUrl);
  const bundleManager = input.bundleManager ?? new SelectorDiscoveryBundleManager();
  let conversationId: string | undefined;
  let bundleHash: string | undefined;
  let status: AoConversationStatus | undefined;

  try {
    const bundle = await bundleManager.loadActive(input.providerDocument, input.model);
    bundleHash = bundle.hash;
    steps.push({ name: 'load-bundle', ok: true, detail: { bundleHash } });

    conversationId = await client.createConversation();
    steps.push({ name: 'create-conversation', ok: true, detail: { conversationId } });

    await bundleManager.upload(client, conversationId, bundle);
    steps.push({ name: 'upload-bundle', ok: true });

    await client.start(conversationId);
    steps.push({ name: 'start', ok: true });

    status = await client.getConversationStatus(conversationId);
    steps.push({ name: 'status', ok: true, detail: status });

    if (!status.sessionId) {
      steps.push({
        name: 'session',
        ok: false,
        detail: status,
        error: 'AO reported ready but did not expose a sessionId after session creation.',
      });
      return { ok: false, conversationId, bundleHash, status, steps };
    }
    steps.push({ name: 'session', ok: true, detail: { sessionId: status.sessionId } });

    const response = await client.message(
      conversationId,
      '# Selector Discovery Smoke Test\n\nReply with one Markdown sentence: selector-discovery ready. Do not output JSON.',
      input.model,
      'selector-discovery'
    );
    steps.push({ name: 'message', ok: true, detail: { messageId: response.messageId, text: response.text ?? '' } });
    return { ok: true, conversationId, bundleHash, status, steps };
  } catch (error) {
    steps.push({
      name: inferFailedStep(steps),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, conversationId, bundleHash, status, steps };
  } finally {
    if (conversationId) {
      try {
        await client.deleteConversation(conversationId);
        steps.push({ name: 'cleanup', ok: true });
      } catch (error) {
        steps.push({ name: 'cleanup', ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}

function inferFailedStep(steps: SelectorDiscoveryPreflightStep[]): SelectorDiscoveryPreflightStep['name'] {
  const last = steps.at(-1)?.name;
  if (!last) return 'load-bundle';
  if (last === 'load-bundle') return 'create-conversation';
  if (last === 'create-conversation') return 'upload-bundle';
  if (last === 'upload-bundle') return 'start';
  if (last === 'start') return 'status';
  if (last === 'status') return 'session';
  if (last === 'session') return 'message';
  return 'message';
}

