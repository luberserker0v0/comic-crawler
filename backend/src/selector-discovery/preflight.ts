import type { ProviderDocument } from './types';
import { AoClient, type AoConversationStatus } from './ao-client';
import { SelectorDiscoveryBundleManager } from './bundle-manager';
import type { SelectorDiscoveryAoModelsResponse, SelectorDiscoveryAoModelSummary, SelectorDiscoveryAoProviderSummary } from '@comiccrawler/shared';

export interface SelectorDiscoveryPreflightStep {
  name: 'load-bundle' | 'create-conversation' | 'upload-bundle' | 'start' | 'status' | 'session' | 'providers' | 'message' | 'cleanup';
  ok: boolean;
  detail?: unknown;
  error?: string;
}

export interface SelectorDiscoveryPreflightResult {
  ok: boolean;
  conversationId?: string;
  bundleHash?: string;
  status?: AoConversationStatus;
  providers?: SelectorDiscoveryAoProviderSummary[];
  models?: SelectorDiscoveryAoModelSummary[];
  steps: SelectorDiscoveryPreflightStep[];
}

export interface SelectorDiscoveryAoProviderListResult extends SelectorDiscoveryAoModelsResponse {
  steps: SelectorDiscoveryPreflightStep[];
}

interface PreflightContext {
  steps: SelectorDiscoveryPreflightStep[];
  client: AoClient;
  conversationId?: string;
  bundleHash?: string;
  status?: AoConversationStatus;
}

interface BundlePreflightInput {
  aoBaseUrl: string;
  providerDocument: ProviderDocument;
  model: string;
  bundleManager?: SelectorDiscoveryBundleManager;
}

export async function runSelectorDiscoveryPreflight(input: BundlePreflightInput): Promise<SelectorDiscoveryPreflightResult> {
  const context = createContext(input.aoBaseUrl);
  try {
    await prepareBundleConversation(context, input);
    await startConversation(context);
    if (!await validateSession(context)) return preflightResult(context, false);
    const providers = await loadProviderSummary(context);
    await sendSmokeTest(context, input.model);
    return { ...preflightResult(context, true), ...providers };
  } catch (error) {
    recordFailure(context, error);
    return preflightResult(context, false);
  } finally {
    await cleanupConversation(context);
  }
}

export async function listSelectorDiscoveryAoProviders(input: BundlePreflightInput): Promise<SelectorDiscoveryAoProviderListResult> {
  const context = createContext(input.aoBaseUrl);
  try {
    await prepareBundleConversation(context, input);
    await startConversation(context);
    const providers = await loadProviderSummary(context);
    return { conversationId: context.conversationId, bundleHash: context.bundleHash,
      ...providers, steps: context.steps };
  } catch (error) {
    recordFailure(context, error);
    throw withPreflightContext(error, context);
  } finally {
    await cleanupConversation(context);
  }
}

export async function listSelectorDiscoveryAoProvidersByUrl(input: {
  aoBaseUrl: string;
}): Promise<SelectorDiscoveryAoProviderListResult> {
  const aoBaseUrl = input.aoBaseUrl?.trim();
  if (!aoBaseUrl) throw new Error('AO URL is required.');
  const context = createContext(aoBaseUrl);
  try {
    await createConversation(context);
    await startConversation(context);
    const providers = await loadProviderSummary(context);
    return { conversationId: context.conversationId, ...providers, steps: context.steps };
  } catch (error) {
    recordFailure(context, error);
    throw withPreflightContext(error, context);
  } finally {
    await cleanupConversation(context);
  }
}

function createContext(url: string): PreflightContext {
  return { steps: [], client: new AoClient(url) };
}

async function prepareBundleConversation(context: PreflightContext,
  input: { providerDocument: ProviderDocument; model: string; bundleManager?: SelectorDiscoveryBundleManager }) {
  const manager = input.bundleManager ?? new SelectorDiscoveryBundleManager();
  const bundle = await manager.loadActive(input.providerDocument, input.model);
  context.bundleHash = bundle.hash;
  context.steps.push({ name: 'load-bundle', ok: true, detail: { bundleHash: bundle.hash } });
  await createConversation(context);
  await manager.upload(context.client, context.conversationId!, bundle);
  context.steps.push({ name: 'upload-bundle', ok: true });
}

async function createConversation(context: PreflightContext): Promise<void> {
  context.conversationId = await context.client.createConversation();
  context.steps.push({ name: 'create-conversation', ok: true,
    detail: { conversationId: context.conversationId } });
}

async function startConversation(context: PreflightContext): Promise<void> {
  await context.client.start(context.conversationId!);
  context.steps.push({ name: 'start', ok: true });
}

async function validateSession(context: PreflightContext): Promise<boolean> {
  context.status = await context.client.getConversationStatus(context.conversationId!);
  context.steps.push({ name: 'status', ok: true, detail: context.status });
  if (!context.status.sessionId) {
    context.steps.push({ name: 'session', ok: false, detail: context.status,
      error: 'AO reported ready but did not expose a sessionId after session creation.' });
    return false;
  }
  context.steps.push({ name: 'session', ok: true, detail: { sessionId: context.status.sessionId } });
  return true;
}

async function loadProviderSummary(context: PreflightContext) {
  const result = summarizeAoProviders(await context.client.listProviders(context.conversationId!));
  context.steps.push({ name: 'providers', ok: true, detail: {
    providerCount: result.providers.length, modelCount: result.models.length } });
  return result;
}

async function sendSmokeTest(context: PreflightContext, model: string): Promise<void> {
  const response = await context.client.message(context.conversationId!,
    '# Selector Discovery Smoke Test\n\nReply with one Markdown sentence: selector-discovery ready. Do not output JSON.',
    model, 'selector-discovery');
  context.steps.push({ name: 'message', ok: true,
    detail: { messageId: response.messageId, text: response.text ?? '' } });
}

function preflightResult(context: PreflightContext, ok: boolean): SelectorDiscoveryPreflightResult {
  return { ok, conversationId: context.conversationId, bundleHash: context.bundleHash,
    status: context.status, steps: context.steps };
}

function recordFailure(context: PreflightContext, error: unknown): void {
  context.steps.push({ name: inferFailedStep(context.steps), ok: false,
    error: error instanceof Error ? error.message : String(error) });
}

function withPreflightContext(error: unknown, context: PreflightContext): Error {
  return Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
    steps: context.steps, conversationId: context.conversationId, bundleHash: context.bundleHash });
}

async function cleanupConversation(context: PreflightContext): Promise<void> {
  if (!context.conversationId) return;
  try {
    await context.client.deleteConversation(context.conversationId);
    context.steps.push({ name: 'cleanup', ok: true });
  } catch (error) {
    context.steps.push({ name: 'cleanup', ok: false,
      error: error instanceof Error ? error.message : String(error) });
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
  if (last === 'session') return 'providers';
  if (last === 'providers') return 'message';
  return 'message';
}

function summarizeAoProviders(value: unknown): Pick<SelectorDiscoveryAoModelsResponse, 'providers' | 'models'> {
  const providersValue = isRecord(value) && Array.isArray(value.providers) ? value.providers : [];
  const providers: SelectorDiscoveryAoProviderSummary[] = [];
  const models: SelectorDiscoveryAoModelSummary[] = [];
  for (const providerValue of providersValue) {
    const provider = summarizeProvider(providerValue);
    if (!provider) continue;
    providers.push(provider);
    models.push(...provider.models);
  }
  return { providers, models };
}

function summarizeProvider(value: unknown): SelectorDiscoveryAoProviderSummary | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  const entries = Object.entries(isRecord(value.models) ? value.models : {});
  const models = entries.map(([id, model]) => summarizeModel(value.id as string, id, model))
    .filter((model): model is SelectorDiscoveryAoModelSummary => Boolean(model));
  return { id: value.id, name: typeof value.name === 'string' ? value.name : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
    modelCount: models.length, models };
}

function summarizeModel(providerId: string, fallbackId: string,
  value: unknown): SelectorDiscoveryAoModelSummary | undefined {
  if (!isRecord(value)) return undefined;
  const modelId = typeof value.id === 'string' ? value.id : fallbackId;
  return { id: `${providerId}/${modelId}`, modelId, providerId,
    name: typeof value.name === 'string' ? value.name : undefined,
    status: typeof value.status === 'string' ? value.status : undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
