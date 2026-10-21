import type { AdapterRegistry } from '../adapter/registry';
import { getAdapterCapabilities } from '../adapter/registry';
import type { AdapterPackageManifest, BrowserConfig, FixtureSummary, IComicAdapter, NetworkConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import { AdapterCatalog } from '../adapter/catalog';
import { createAdapterPackage } from '../adapter/package-builder';
import { loadCatalogAdapters } from '../adapter/catalog-runtime';
import { AoClient } from './ao-client';
import { SelectorDiscoveryBundleManager } from './bundle-manager';
import { fetchSafeHtml, normalizeAndValidateUrl, type SafeHtmlFetchResult } from './safe-fetch';
import { looksLikeAntiBotChallenge } from '../crawler/anti-bot';
import { SelectorDiscoverySettingsStore } from './settings-store';
import { validateAdapterImplementationDraft, validateCapabilityDraft } from './adapter-implementation';
import { instantiateAdapterImplementationDraft } from './adapter-draft-runtime';
import { createChapterOnlyTaskMarkdown, createPhase1TaskMarkdown, createPhase2TaskMarkdown, extractFallbackChapterUrlFromHtml, validatePhase1Markdown } from './task-markdown';
import {
  adapterSupportsDiscoveryTarget,
  createAoPhaseRetryFeedback,
  createCapabilityRetryFeedback,
  createFunctionRevisionTaskMarkdown,
  extractFirstTypeScriptFence,
  formatAoFunctionRevisionFailure,
  formatAoPhaseFailureError,
  formatCapabilityDraftFailureReview,
  formatCapabilityStageSmokeReview,
  runAoFunctionRevisionWithRetry,
  shouldRetryCapabilityDraft,
} from './service-capability-drafts';
import {
  composeAdapterShellFromCapabilities,
  createChapterOnlyPhase1Markdown,
  createCommonVerificationSkeleton,
  createMetadataSkeleton,
  tryExtractRepresentativeChapterUrl,
  validateMetadataSelectorEvidence,
} from './service-shell-compose';
import {
  DEFAULT_SELECTOR_DISCOVERY_AGENT,
  DEFAULT_SELECTOR_DISCOVERY_MODEL,
  type DiscoveryInput,
  type SelectorDiscoveryJob,
  type SelectorDiscoveryCapabilityDraft,
} from './types';
import { ConcurrentSchedulingPolicy, TaskScheduler, type SchedulingPolicy } from '../scheduler';
import type { TaskItem } from '../task/types';

const JOB_PREFIX = 'selector-discovery-job-';
const INDEX_KEY = 'selector-discovery-index';
const CAPABILITY_DRAFT_OUTPUTS: Array<Omit<SelectorDiscoveryCapabilityDraft, 'sourceTs' | 'reviewMarkdown' | 'validation'>> = [
  { stage: 'common-verification', sourcePath: 'outputs/common-verification.ts', reviewPath: 'outputs/common-verification-review.md' },
  { stage: 'metadata', sourcePath: 'outputs/metadata-capability.ts', reviewPath: 'outputs/metadata-review.md' },
  { stage: 'chapter-images', sourcePath: 'outputs/chapter-images-capability.ts', reviewPath: 'outputs/chapter-images-review.md' },
];

type RegisteredAdapter = ReturnType<AdapterRegistry['getAll']>[number];
type DiscoveryBundle = Awaited<ReturnType<SelectorDiscoveryBundleManager['loadActive']>>;
type SafeFetchOptions = NonNullable<Parameters<typeof fetchSafeHtml>[1]>;
type RevisionTask = NonNullable<SelectorDiscoveryJob['functionRevisionTasks']>[number];

interface DiscoveryCreateContext {
  normalizedUrl: string; hostname: string; target: 'full' | 'chapter-only';
  matchedAdapter?: RegisteredAdapter; domainMatchedAdapter?: RegisteredAdapter; canAugment: boolean;
}

interface DiscoveryRunConfiguration {
  aoBaseUrl: string;
  model: string;
  providerDocument: NonNullable<DiscoveryInput['providerDocument']>;
}

interface ChapterOnlyDiscoveryInput {
  client: AoClient; bundle: DiscoveryBundle; model: string; aoBaseUrl: string;
  chapterFetch: SafeHtmlFetchResult; phase1Markdown: string;
}

interface RevisionRuntime {
  job: SelectorDiscoveryJob;
  settings: Awaited<ReturnType<SelectorDiscoverySettingsStore['getRequired']>>['settings'] & {
    model: string; aoBaseUrl: string;
  };
  providerDocument: Awaited<ReturnType<SelectorDiscoverySettingsStore['getRequired']>>['providerDocument'];
  client: AoClient;
}

interface AoPhaseOptions { validate?: (markdown: string) => { valid: boolean; errors: string[] } }

function normalizeServiceOptions(
  value?: SelectorDiscoveryBundleManager | SelectorDiscoveryServiceOptions
): SelectorDiscoveryServiceOptions {
  return value instanceof SelectorDiscoveryBundleManager ? { bundleManager: value } : value ?? {};
}

function createDiscoveryScheduler(
  execute: (task: TaskItem<DiscoveryInput>) => Promise<void>, policy?: SchedulingPolicy<DiscoveryInput>
): TaskScheduler<DiscoveryInput> {
  const fallback = new ConcurrentSchedulingPolicy<DiscoveryInput>({ maxConcurrency: 2,
    maxConcurrencyPerGroup: 1, groupBy: (task) => new URL(task.data.url).hostname });
  return new TaskScheduler(execute, { autoStart: true, concurrency: 1 }, policy ?? fallback);
}

function createDiscoveryContext(input: DiscoveryInput, registry: AdapterRegistry): DiscoveryCreateContext {
  const normalizedUrl = normalizeAndValidateUrl(input.url);
  const matchedAdapter = registry.findByUrl(normalizedUrl);
  const domainMatchedAdapter = matchedAdapter ?? registry.findByUrlDomain(normalizedUrl);
  const target = input.target ?? 'full';
  const canAugment = Boolean(domainMatchedAdapter && target === 'full'
    && !adapterSupportsDiscoveryTarget(domainMatchedAdapter, target)
    && getAdapterCapabilities(domainMatchedAdapter).chapterImages);
  return { normalizedUrl, hostname: new URL(normalizedUrl).hostname, target,
    matchedAdapter, domainMatchedAdapter, canAugment };
}

function createBaseDiscoveryJob(
  id: string, input: DiscoveryInput, context: DiscoveryCreateContext,
  status: SelectorDiscoveryJob['status']
): SelectorDiscoveryJob {
  const now = new Date().toISOString();
  return { id, url: input.url, normalizedUrl: context.normalizedUrl, hostname: context.hostname,
    status, target: context.target, promotionMode: context.canAugment ? 'augment' : 'create',
    baseAdapterId: context.canAugment ? context.domainMatchedAdapter?.id : undefined,
    createdAt: now, updatedAt: now, ownerUserId: input.ownerUserId,
    browserTarget: input.browserTarget, browserSessionId: input.browserSessionId };
}

function createQueuedDiscoveryJob(
  id: string, input: DiscoveryInput, context: DiscoveryCreateContext
): SelectorDiscoveryJob {
  return { ...createBaseDiscoveryJob(id, input, context, 'queued'), model: input.model,
    aoBaseUrl: input.aoBaseUrl, stopAfterStage: input.stopAfterStage,
    inputSource: input.htmlSnapshot ? 'html-snapshot' : 'live-fetch' };
}

function requireRevisionSource(source: string | undefined, job: SelectorDiscoveryJob): string {
  const value = source?.trim() || job.adapterImplementationTs?.trim();
  if (!value) throw new Error('Discovery job has no TypeScript implementation draft to revise.');
  return value;
}

function createRevisionTask(job: SelectorDiscoveryJob, functionId: string, instruction: string): RevisionTask {
  const now = new Date().toISOString();
  return { id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parentDiscoveryId: job.id, functionId, instruction: instruction.trim(), status: 'queued',
    createdAt: now, updatedAt: now };
}

function findRepresentativeChapterUrl(phase1: string, metadata: SafeHtmlFetchResult): string {
  const url = tryExtractRepresentativeChapterUrl(phase1, metadata.finalUrl)
    ?? extractFallbackChapterUrlFromHtml(metadata.html, metadata.finalUrl);
  if (!url) throw new Error(
    'Phase 1 output did not include a Representative Chapter URL and no fallback chapter link was found.');
  return url;
}

const AO_PHASE_MESSAGE_TEMPLATE = `{{TASK}}

## Required AO Output

Write the full Markdown result to {{OUTPUT}}.

Also return the same Markdown result in your chat response. Do not only summarize. Do not output JSON.

Use the exact Markdown headings required by the referenced contract file. Do not rename, decorate, or add parenthetical suffixes to required headings. If this is the final candidate, the first required section must be exactly "## Adapter Identity".
{{FEEDBACK}}`;

function createAoPhaseMessage(task: string, output: string, feedback: string): string {
  return AO_PHASE_MESSAGE_TEMPLATE.replace('{{TASK}}', task)
    .replace('{{OUTPUT}}', output).replace('{{FEEDBACK}}', feedback);
}

function capabilityStageResult(
  drafts: SelectorDiscoveryCapabilityDraft[], stopAfter?: SelectorDiscoveryCapabilityDraft['stage']
) {
  const latest = drafts.at(-1);
  if (latest?.validation && !latest.validation.valid)
    return { adapterImplementationTs: '', reviewNotesMarkdown: formatCapabilityDraftFailureReview(drafts),
      capabilityDrafts: drafts };
  if (latest && stopAfter === latest.stage)
    return { adapterImplementationTs: '', reviewNotesMarkdown: formatCapabilityStageSmokeReview(drafts),
      capabilityDrafts: drafts };
  return undefined;
}

const CAPABILITY_MESSAGE_TEMPLATE = `# Capability Stage Task

Read task.md plus the named contracts. Produce only stage \`{{STAGE}}\`:

- TypeScript: {{SOURCE}}
- Markdown review: {{REVIEW}}

Use exact capability signatures. Keep source out of review notes and chat. Do not output JSON, import Markdown contracts, write the AdapterBase shell, or mix capabilities. The supplied DOM is prepared Playwright output; capability code extracts from it and does not perform browser actions.
{{INSTRUCTION}}
{{RETRY}}

After writing both files, reply with one short confirmation sentence.`;

function createCapabilityMessage(
  draft: Omit<SelectorDiscoveryCapabilityDraft, 'sourceTs' | 'reviewMarkdown' | 'validation'>,
  job: SelectorDiscoveryJob, retry?: string
): string {
  return CAPABILITY_MESSAGE_TEMPLATE.replace('{{STAGE}}', draft.stage)
    .replace('{{SOURCE}}', draft.sourcePath).replace('{{REVIEW}}', draft.reviewPath)
    .replace('{{INSTRUCTION}}', capabilityTemplateInstruction(draft.stage, job))
    .replace('{{RETRY}}', retry ? `## Retry Feedback\n\n${retry}` : '');
}

function capabilityTemplateInstruction(stage: SelectorDiscoveryCapabilityDraft['stage'], job: SelectorDiscoveryJob): string {
  if (stage === 'common-verification') return COMMON_CAPABILITY_INSTRUCTION
    .replace('{{HOST}}', job.hostname)
    .replace('{{SKELETON}}', createCommonVerificationSkeleton(job.normalizedUrl, job.hostname));
  if (stage === 'metadata') return METADATA_CAPABILITY_INSTRUCTION
    .replace('{{SKELETON}}', createMetadataSkeleton(job.hostname));
  return '';
}

const COMMON_CAPABILITY_INSTRUCTION = `Copy this skeleton. Change URL matching and challenge signals only. Keep its imports, classes, and methods; include hostname {{HOST}} and remove all example placeholders.

\`\`\`ts
{{SKELETON}}
\`\`\``;

const METADATA_CAPABILITY_INSTRUCTION = `Copy this skeleton. Replace every placeholder selector and throw with evidence from task.md. Keep one MetadataCapability subclass. Follow ChapterInfo rules in adapter-base-api.md and return the complete supplied catalog.

\`\`\`ts
{{SKELETON}}
\`\`\``;

async function readCapabilityOutput(
  client: AoClient, conversationId: string,
  draft: Omit<SelectorDiscoveryCapabilityDraft, 'sourceTs' | 'reviewMarkdown' | 'validation'>,
  chat?: string
) {
  const [source, review] = await Promise.all([
    client.readFile(conversationId, draft.sourcePath).catch(() => ''),
    client.readFile(conversationId, draft.reviewPath).catch(() => ''),
  ]);
  const reviewText = review.trim();
  const chatText = chat?.trim() || '';
  return { sourceTs: source.trim() || extractFirstTypeScriptFence(reviewText)
    || extractFirstTypeScriptFence(chatText), reviewMarkdown: reviewText || chatText };
}

function validateCapabilityOutput(
  draft: Omit<SelectorDiscoveryCapabilityDraft, 'sourceTs' | 'reviewMarkdown' | 'validation'>,
  job: SelectorDiscoveryJob, task: string, source: string, target?: 'full' | 'chapter-only'
) {
  const validation = validateCapabilityDraft(source, { stage: draft.stage, target });
  if (draft.stage === 'common-verification' && source && !source.includes(job.hostname))
    validation.errors.push(`Common/verification draft must include target hostname "${job.hostname}".`);
  if (draft.stage === 'metadata' && source)
    validation.errors.push(...validateMetadataSelectorEvidence(source, task));
  validation.valid = validation.errors.length === 0;
  return validation;
}

function validateHtmlSnapshot(job: SelectorDiscoveryJob, input: DiscoveryInput) {
  if (job.target !== 'chapter-only')
    throw new Error('HTML snapshot discovery currently supports chapter-only targets.');
  const snapshot = input.htmlSnapshot;
  if (!snapshot?.html?.trim()) throw new Error('HTML snapshot is required.');
  if (snapshot.html.length > 2_000_000)
    throw new Error('HTML snapshot is too large. Maximum size is 2,000,000 characters.');
  if (looksLikeAntiBotChallenge(snapshot.html)) throw new Error(
    'HTML snapshot still looks like an anti-bot challenge or blocked page. Open the real chapter page after verification, then capture the rendered comic DOM.');
  return snapshot;
}

function createSnapshotFetch(url: string, finalUrl: string, html: string): SafeHtmlFetchResult {
  return { url, finalUrl, redirectChain: [], html, contentType: 'text/html; source=user-snapshot' };
}

const SNAPSHOT_PHASE1_TEMPLATE = `# Phase 1 Result

## Site Decision
- Snapshot source: user-provided rendered chapter HTML.
- Discovery target: chapter-only adapter.

## Title Extraction
- Not required for chapter-only discovery.

## Chapter List Extraction
- Not required for chapter-only discovery.

## Representative Chapter URL
{{URL}}

## Evidence
- The user supplied a verified browser HTML snapshot for the target chapter page.
- Backend rejected challenge/blocked snapshots before AO analysis.

## Uncertainty
- Metadata and chapter list extraction are intentionally out of scope for chapter-only discovery.
`;

function createSnapshotPhase1(url: string): string {
  return SNAPSHOT_PHASE1_TEMPLATE.replace('{{URL}}', url);
}

function createImplementationValidation(
  job: SelectorDiscoveryJob,
  output: { adapterImplementationTs: string; capabilityDrafts?: SelectorDiscoveryCapabilityDraft[] },
  errors: string[]
) {
  const smoke = Boolean(job.stopAfterStage
    && output.capabilityDrafts?.some((draft) => draft.stage === job.stopAfterStage));
  return smoke ? { valid: errors.length === 0, errors: [], warnings: [], syntaxValid: true }
    : validateAdapterImplementationDraft(output.adapterImplementationTs, { target: job.target });
}

function appendRevisionNotes(previous: string | undefined, id: string, notes: string): string {
  return [previous, '', `# Function Revision ${id}`, '', notes].filter(Boolean).join('\n');
}

function validatePromotionJob(
  job: SelectorDiscoveryJob
): asserts job is SelectorDiscoveryJob & { adapterImplementationTs: string } {
  if (job.status !== 'awaiting_review')
    throw new Error('Only awaiting_review discovery jobs can be promoted.');
  if (!job.adapterImplementationTs?.trim())
    throw new Error('Discovery job has no adapter implementation draft.');
  if (!job.implementationValidation?.valid) {
    const errors = job.implementationValidation?.errors?.join('; ') || 'implementation validation did not pass';
    throw new Error(`Adapter implementation draft is invalid: ${errors}`);
  }
}

export type SelectorDiscoveryPromotionResult = AdapterPackageManifest;

interface SelectorDiscoveryServiceOptions {
  adapterCatalog?: AdapterCatalog;
  bundleManager?: SelectorDiscoveryBundleManager;
  getBrowserConfig?: (sessionId?: string) => BrowserConfig | Promise<BrowserConfig>;
  acquireBrowserSession?: (input: { job: SelectorDiscoveryJob; browserTarget?: DiscoveryInput['browserTarget'] }) =>
    Promise<{ sessionId: string; release(): Promise<void> }>;
  getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
  renderBrowserPage?: (sessionId: string, url: string, options: { timeoutMs: number }) =>
    Promise<{ url: string; html: string }>;
  captureApprovalFixture?: (input: { job: SelectorDiscoveryJob; adapter: IComicAdapter }) => Promise<FixtureSummary>;
  schedulingPolicy?: SchedulingPolicy<DiscoveryInput>;
}

export class SelectorDiscoveryService {
  private readonly inFlightHosts = new Set<string>();
  private readonly bundleManager: SelectorDiscoveryBundleManager;
  private readonly getBrowserConfig?: (sessionId?: string) => BrowserConfig | Promise<BrowserConfig>;
  private readonly acquireBrowserSession?: (input: {
    job: SelectorDiscoveryJob;
    browserTarget?: DiscoveryInput['browserTarget'];
  }) => Promise<{ sessionId: string; release(): Promise<void> }>;
  private readonly getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
  private readonly renderBrowserPage?: (
    sessionId: string,
    url: string,
    options: { timeoutMs: number }
  ) => Promise<{ url: string; html: string }>;
  private readonly captureApprovalFixture?: (input: {
    job: SelectorDiscoveryJob;
    adapter: IComicAdapter;
  }) => Promise<FixtureSummary>;
  private readonly scheduler: TaskScheduler<DiscoveryInput>;
  private readonly adapterCatalog: AdapterCatalog;

  constructor(
    private readonly storage: IStorage,
    private readonly adapterRegistry: AdapterRegistry,
    bundleManagerOrOptions?: SelectorDiscoveryBundleManager | SelectorDiscoveryServiceOptions
  ) {
    const options = normalizeServiceOptions(bundleManagerOrOptions);
    this.adapterCatalog = options.adapterCatalog ?? new AdapterCatalog(storage);
    this.bundleManager = options.bundleManager ?? new SelectorDiscoveryBundleManager();
    this.getBrowserConfig = options.getBrowserConfig;
    this.acquireBrowserSession = options.acquireBrowserSession;
    this.getNetworkConfig = options.getNetworkConfig;
    this.renderBrowserPage = options.renderBrowserPage;
    this.captureApprovalFixture = options.captureApprovalFixture;
    this.scheduler = createDiscoveryScheduler(
      (task) => this.executeScheduledDiscovery(task), options.schedulingPolicy);
  }

  async initializeScheduler(): Promise<void> {
    const resumable = (await this.list()).filter((job) => job.status === 'queued' || job.status === 'running');
    for (const job of resumable) {
      await this.updateJob(job.id, { status: 'queued' });
      await this.scheduleDiscovery(job, {
        url: job.normalizedUrl,
        target: job.target,
        forceDiscovery: job.promotionMode === 'augment' || Boolean(job.baseAdapterId),
        stopAfterStage: job.stopAfterStage,
        ownerUserId: job.ownerUserId,
        browserTarget: job.browserTarget,
        browserSessionId: job.browserSessionId,
      });
    }
  }

  dispose(): void {
    this.scheduler.stop();
  }

  async create(input: DiscoveryInput): Promise<SelectorDiscoveryJob> {
    const context = createDiscoveryContext(input, this.adapterRegistry);
    const known = await this.createKnownAdapterJob(input, context);
    if (known) return known;
    const existing = (await this.list()).find((job) => job.hostname === context.hostname
      && job.ownerUserId === input.ownerUserId && ['queued', 'running'].includes(job.status));
    if (existing) return existing;
    const configurationRequired = await this.createConfigurationRequiredJob(input, context);
    if (configurationRequired) return configurationRequired;
    const job = createQueuedDiscoveryJob(this.createJobId(), input, context);
    await this.saveJob(job);
    await this.scheduleDiscovery(job, input);
    return job;
  }

  private async createKnownAdapterJob(
    input: DiscoveryInput, context: DiscoveryCreateContext
  ): Promise<SelectorDiscoveryJob | undefined> {
    const adapter = context.matchedAdapter;
    if (!adapter || input.forceDiscovery || !adapterSupportsDiscoveryTarget(adapter, context.target)) return undefined;
    const job = createBaseDiscoveryJob(this.createJobId(), input, context, 'known_adapter');
    Object.assign(job, { promotionMode: 'create', adapterId: adapter.id,
      adapterName: adapter.name, phase: 'known_adapter' });
    await this.saveJob(job);
    return job;
  }

  private async createConfigurationRequiredJob(
    input: DiscoveryInput, context: DiscoveryCreateContext
  ): Promise<SelectorDiscoveryJob | undefined> {
    if (input.providerDocument && input.aoBaseUrl && input.model) return undefined;
    const settings = await new SelectorDiscoverySettingsStore(this.storage).getSummary();
    if (settings.configured) return undefined;
    const job = createBaseDiscoveryJob(this.createJobId(), input, context, 'configuration_required');
    job.error = 'Selector discovery is not configured. Configure AO URL, provider JSON, and model in Settings before this adapter build task can run.';
    await this.saveJob(job);
    return job;
  }

  async retry(id: string): Promise<SelectorDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    const replacement = await this.create({
      url: job.normalizedUrl,
      target: job.target,
      forceDiscovery: job.promotionMode === 'augment' || Boolean(job.baseAdapterId),
      ownerUserId: job.ownerUserId,
      browserTarget: job.browserTarget,
      browserSessionId: job.browserSessionId,
    });
    if (replacement.id !== job.id) {
      await this.updateJob(replacement.id, { retriedFromId: job.id });
    }
    if (job.status === 'configuration_required' && replacement.id !== job.id) {
      await this.deleteJob(job.id);
    }
    return (await this.get(replacement.id)) ?? replacement;
  }

  async loadActiveAdapters(): Promise<void> {
    await this.adapterCatalog.initialize();
    await loadCatalogAdapters(this.adapterCatalog, this.adapterRegistry);
  }

  async promote(id: string): Promise<SelectorDiscoveryPromotionResult> {
    const job = await this.getRequiredJob(id);
    return this.promoteImplementationDraft(job);
  }

  async reject(id: string): Promise<SelectorDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    await this.updateJob(id, { status: 'invalid', error: 'Rejected by reviewer.' });
    return (await this.get(id)) ?? job;
  }

  async requestFunctionRevision(input: {
    id: string;
    functionId: string;
    instruction: string;
    currentSource?: string;
  }): Promise<SelectorDiscoveryJob> {
    const job = await this.getRequiredJob(input.id);
    const source = requireRevisionSource(input.currentSource, job);
    if (!input.instruction.trim()) throw new Error('Revision instruction is required.');
    const revisionTask = createRevisionTask(job, input.functionId, input.instruction);
    await this.updateJob(job.id, {
      functionRevisionTasks: [...(job.functionRevisionTasks ?? []), revisionTask],
    });
    this.startFunctionRevision(job.id, revisionTask.id, source);
    return this.getRequiredJob(job.id);
  }

  async retryFunctionRevision(input: {
    id: string;
    revisionTaskId: string;
    currentSource?: string;
    modelMode?: 'current-settings' | 'previous-task';
  }): Promise<SelectorDiscoveryJob> {
    const job = await this.getRequiredJob(input.id);
    const revisionTask = job.functionRevisionTasks?.find((task) => task.id === input.revisionTaskId);
    if (!revisionTask) throw new Error(`Function revision task "${input.revisionTaskId}" was not found.`);
    if (revisionTask.status === 'running')
      throw new Error(`Function revision task "${input.revisionTaskId}" is already running.`);
    const source = requireRevisionSource(input.currentSource, job);
    await this.updateFunctionRevisionTask(job, input.revisionTaskId, { status: 'queued', error: undefined });
    this.startFunctionRevision(job.id, input.revisionTaskId, source,
      { modelMode: input.modelMode ?? 'current-settings' });
    return this.getRequiredJob(job.id);
  }

  private startFunctionRevision(
    jobId: string, taskId: string, source: string,
    options: { modelMode?: 'current-settings' | 'previous-task' } = {}
  ): void {
    void this.runFunctionRevision(jobId, taskId, source, options).catch(async (error) => {
      const latest = await this.get(jobId);
      if (latest) await this.updateFunctionRevisionTask(latest, taskId, { status: 'failed',
        error: error instanceof Error ? error.message : String(error) });
    });
  }

  async get(id: string): Promise<SelectorDiscoveryJob | null> {
    return this.storage.read<SelectorDiscoveryJob>(`${JOB_PREFIX}${id}`);
  }

  async deleteJob(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    const ids = (await this.storage.read<string[]>(INDEX_KEY)) ?? [];
    await this.storage.write(INDEX_KEY, ids.filter((entry) => entry !== id));
    await this.storage.delete(`${JOB_PREFIX}${id}`);
    await this.storage.delete(`selector-discovery-implementation-${id}`);
    return true;
  }

  async list(): Promise<SelectorDiscoveryJob[]> {
    const ids = (await this.storage.read<string[]>(INDEX_KEY)) ?? [];
    const jobs = await Promise.all(ids.map((id) => this.get(id)));
    return jobs.filter((job): job is SelectorDiscoveryJob => !!job).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async run(id: string, input: DiscoveryInput): Promise<void> {
    const job = await this.getRequiredJob(id);
    this.inFlightHosts.add(job.hostname);
    try {
      await this.updateJob(job.id, { status: 'running', phase: 'phase1' });
      const configuration = await this.resolveRunConfiguration(input);
      if (input.htmlSnapshot) await this.runFromHtmlSnapshot(job, input, configuration);
      else await this.runLiveDiscovery(job, input, configuration);
    } finally {
      this.inFlightHosts.delete(job.hostname);
    }
  }

  private async resolveRunConfiguration(input: DiscoveryInput): Promise<DiscoveryRunConfiguration> {
    if (input.providerDocument && input.aoBaseUrl && input.model)
      return { aoBaseUrl: input.aoBaseUrl, model: input.model, providerDocument: input.providerDocument };
    const configured = await new SelectorDiscoverySettingsStore(this.storage).getRequired();
    return { aoBaseUrl: input.aoBaseUrl ?? configured.settings.aoBaseUrl,
      model: input.model ?? configured.settings.model ?? DEFAULT_SELECTOR_DISCOVERY_MODEL,
      providerDocument: input.providerDocument ?? configured.providerDocument };
  }

  private async runLiveDiscovery(
    job: SelectorDiscoveryJob, input: DiscoveryInput, configuration: DiscoveryRunConfiguration
  ): Promise<void> {
    const safeFetch = await this.getSafeFetchOptions(input.browserSessionId);
    const client = new AoClient(configuration.aoBaseUrl);
    const bundle = await this.bundleManager.loadActive(configuration.providerDocument, configuration.model);
    if (job.target === 'chapter-only') {
      const chapterFetch = await fetchSafeHtml(job.normalizedUrl, safeFetch);
      return this.runChapterOnlyDiscovery(job, { client, bundle, model: configuration.model,
        aoBaseUrl: configuration.aoBaseUrl, chapterFetch,
        phase1Markdown: createChapterOnlyPhase1Markdown(chapterFetch.finalUrl) });
    }
    await this.runFullDiscovery(job, input, configuration, client, bundle, safeFetch);
  }

  private async runFullDiscovery(
    job: SelectorDiscoveryJob, input: DiscoveryInput, config: DiscoveryRunConfiguration,
    client: AoClient, bundle: DiscoveryBundle, safeFetch: SafeFetchOptions
  ): Promise<void> {
    const metadataFetch = await fetchSafeHtml(job.normalizedUrl, safeFetch);
    const existingAdapter = await this.createExistingAdapterContext(job);
    const task = createPhase1TaskMarkdown({ url: job.normalizedUrl, metadataFetch, existingAdapter });
    const phase1 = await this.runAoPhase(client, bundle, config.model, task,
      'outputs/phase1-output.md', { validate: validatePhase1Markdown });
    if (!await this.acceptPhase1(job, phase1, config)) return;
    const chapterUrl = findRepresentativeChapterUrl(phase1, metadataFetch);
    const chapterFetch = await fetchSafeHtml(chapterUrl, safeFetch);
    const phase2 = createPhase2TaskMarkdown({ url: job.normalizedUrl, phase1Markdown: phase1,
      chapterFetch, existingAdapter });
    const output = await this.runAoImplementationPhase(job, client, bundle, config.model,
      phase2, input.stopAfterStage);
    await this.finalizeImplementationDraft(job, output);
  }

  private async acceptPhase1(
    job: SelectorDiscoveryJob, phase1: string, config: DiscoveryRunConfiguration
  ): Promise<boolean> {
    const validation = validatePhase1Markdown(phase1);
    if (validation.valid) {
      await this.updateJob(job.id, { phase1Markdown: phase1, phase: 'phase2',
        model: config.model, aoBaseUrl: config.aoBaseUrl });
      return true;
    }
    await this.updateJob(job.id, { status: 'invalid', phase: 'complete', phase1Markdown: phase1,
      model: config.model, aoBaseUrl: config.aoBaseUrl,
      error: formatAoPhaseFailureError({ outputPath: 'outputs/phase1-output.md', model: config.model,
        errors: validation.errors, emptyOutput: !phase1.trim() }) });
    return false;
  }

  private async scheduleDiscovery(job: SelectorDiscoveryJob, input: DiscoveryInput): Promise<void> {
    await this.scheduler.add({
      id: job.id,
      status: 'pending',
      priority: 0,
      createdAt: new Date(job.createdAt),
      data: input,
    });
  }

  private async executeScheduledDiscovery(task: TaskItem<DiscoveryInput>): Promise<void> {
    let acquired: { sessionId: string; release(): Promise<void> } | undefined;
    try {
      const job = await this.getRequiredJob(task.id);
      acquired = task.data.htmlSnapshot ? undefined : await this.acquireBrowserSession?.(
        { job, browserTarget: task.data.browserTarget });
      const input = acquired ? { ...task.data, browserSessionId: acquired.sessionId } : task.data;
      await this.run(task.id, input);
    } catch (error) {
      await this.markScheduledDiscoveryFailed(task.id, error);
      throw error;
    } finally {
      await acquired?.release();
    }
  }

  private async markScheduledDiscoveryFailed(id: string, error: unknown): Promise<void> {
    const failed = await this.get(id);
    if (!failed) return;
    failed.status = 'failed';
    failed.error = error instanceof Error ? error.message : String(error);
    failed.updatedAt = new Date().toISOString();
    await this.saveJob(failed);
  }

  private async runAoPhase(
    client: AoClient, bundle: DiscoveryBundle, model: string, taskMarkdown: string,
    outputPath: string, options: AoPhaseOptions = {}
  ): Promise<string> {
    let lastOutput = '';
    let retryFeedback = '';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      lastOutput = await this.runAoPhaseAttempt(client, bundle, model, taskMarkdown,
        outputPath, retryFeedback);
      const validation = options.validate?.(lastOutput);
      if (!options.validate || validation?.valid) return lastOutput;
      if (attempt < 2 && validation)
        retryFeedback = createAoPhaseRetryFeedback(outputPath, lastOutput, validation.errors);
    }
    return lastOutput;
  }

  private async runAoPhaseAttempt(
    client: AoClient, bundle: DiscoveryBundle, model: string, task: string,
    outputPath: string, feedback: string
  ): Promise<string> {
    const conversationId = await client.createConversation();
    try {
      await this.bundleManager.upload(client, conversationId, bundle);
      await client.uploadFile(conversationId, 'task.md', task);
      await client.start(conversationId);
      const response = await client.message(conversationId,
        createAoPhaseMessage(task, outputPath, feedback), model, DEFAULT_SELECTOR_DISCOVERY_AGENT);
      const output = await client.readFile(conversationId, outputPath).catch(() => '');
      return output.trim() || response.text?.trim() || '';
    } finally { await client.deleteConversation(conversationId).catch(() => undefined); }
  }

  private async runAoImplementationPhase(
    job: SelectorDiscoveryJob,
    client: AoClient,
    bundle: Awaited<ReturnType<SelectorDiscoveryBundleManager['loadActive']>>,
    model: string,
    taskMarkdown: string,
    stopAfterStage?: SelectorDiscoveryCapabilityDraft['stage']
  ): Promise<{ reviewNotesMarkdown: string; adapterImplementationTs: string; capabilityDrafts: SelectorDiscoveryCapabilityDraft[] }> {
    const stages = CAPABILITY_DRAFT_OUTPUTS.filter((draft) => job.target !== 'chapter-only' || draft.stage !== 'metadata');
    const capabilityDrafts: SelectorDiscoveryCapabilityDraft[] = [];
    for (const draft of stages) {
      await this.updateJob(job.id, { phase: draft.stage, capabilityDrafts });
      const capabilityDraft = await this.runAoCapabilityPhaseWithRetries(client, bundle, model, taskMarkdown, draft, job, job.target);
      capabilityDrafts.push(capabilityDraft);
      const early = capabilityStageResult(capabilityDrafts, stopAfterStage);
      if (early) return early;
    }
    await this.updateJob(job.id, { phase: 'compose', capabilityDrafts });
    return { ...composeAdapterShellFromCapabilities(job, capabilityDrafts), capabilityDrafts };
  }

  private async runAoCapabilityPhaseWithRetries(
    client: AoClient,
    bundle: Awaited<ReturnType<SelectorDiscoveryBundleManager['loadActive']>>,
    model: string,
    taskMarkdown: string,
    draft: Omit<SelectorDiscoveryCapabilityDraft, 'sourceTs' | 'reviewMarkdown' | 'validation'>,
    job: SelectorDiscoveryJob,
    target?: 'full' | 'chapter-only'
  ): Promise<SelectorDiscoveryCapabilityDraft> {
    let retryFeedback: string | undefined;
    let latest: SelectorDiscoveryCapabilityDraft | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      latest = await this.runAoCapabilityPhase(client, bundle, model, taskMarkdown, draft, job, target, retryFeedback);
      if (latest.sourceTs?.trim() && (!latest.validation || latest.validation.valid || !shouldRetryCapabilityDraft(latest))) {
        return latest;
      }
      retryFeedback = createCapabilityRetryFeedback(latest, attempt);
    }
    return latest!;
  }

  private async runAoCapabilityPhase(
    client: AoClient, bundle: DiscoveryBundle, model: string, taskMarkdown: string,
    draft: Omit<SelectorDiscoveryCapabilityDraft, 'sourceTs' | 'reviewMarkdown' | 'validation'>,
    job: SelectorDiscoveryJob, target?: 'full' | 'chapter-only', retryFeedback?: string
  ): Promise<SelectorDiscoveryCapabilityDraft> {
    const conversationId = await client.createConversation();
    try {
      await this.bundleManager.upload(client, conversationId, bundle);
      await client.uploadFile(conversationId, 'task.md', taskMarkdown);
      await client.start(conversationId);
      const response = await client.message(conversationId,
        createCapabilityMessage(draft, job, retryFeedback), model, DEFAULT_SELECTOR_DISCOVERY_AGENT);
      const output = await readCapabilityOutput(client, conversationId, draft, response.text);
      const validation = validateCapabilityOutput(draft, job, taskMarkdown, output.sourceTs, target);
      return { ...draft, ...output, validation };
    } finally {
      await client.deleteConversation(conversationId).catch(() => undefined);
    }
  }

  private async runFromHtmlSnapshot(
    job: SelectorDiscoveryJob,
    input: DiscoveryInput,
    configured: {
      aoBaseUrl: string;
      model: string;
      providerDocument: NonNullable<DiscoveryInput['providerDocument']>;
    }
  ): Promise<void> {
    const snapshot = validateHtmlSnapshot(job, input);
    const finalUrl = normalizeAndValidateUrl(snapshot.finalUrl ?? job.normalizedUrl);
    const chapterFetch = createSnapshotFetch(job.normalizedUrl, finalUrl, snapshot.html);
    const client = new AoClient(configured.aoBaseUrl);
    const bundle = await this.bundleManager.loadActive(configured.providerDocument, configured.model);
    await this.runChapterOnlyDiscovery(job, {
      client, bundle, model: configured.model, aoBaseUrl: configured.aoBaseUrl, chapterFetch,
      phase1Markdown: createSnapshotPhase1(finalUrl),
    });
  }

  private async runChapterOnlyDiscovery(
    job: SelectorDiscoveryJob,
    input: ChapterOnlyDiscoveryInput
  ): Promise<void> {
    await this.updateJob(job.id, {
      phase1Markdown: input.phase1Markdown, phase: 'phase2', model: input.model, aoBaseUrl: input.aoBaseUrl,
    });
    const task = createChapterOnlyTaskMarkdown({ url: job.normalizedUrl, chapterFetch: input.chapterFetch });
    const implementation = await this.runAoImplementationPhase(
      job, input.client, input.bundle, input.model, task);
    await this.finalizeImplementationDraft(job, implementation);
  }

  private async finalizeImplementationDraft(
    job: SelectorDiscoveryJob,
    output: { reviewNotesMarkdown: string; adapterImplementationTs: string; capabilityDrafts?: SelectorDiscoveryCapabilityDraft[] }
  ): Promise<void> {
    const capabilityErrors = (output.capabilityDrafts ?? [])
      .flatMap((draft) => draft.validation?.valid === false
        ? draft.validation.errors.map((error) => `${draft.stage}: ${error}`)
        : []);
    const implementationValidation = createImplementationValidation(job, output, capabilityErrors);
    const valid = capabilityErrors.length === 0 && implementationValidation.valid;
    const saved = { reviewNotesMarkdown: output.reviewNotesMarkdown,
      capabilityDrafts: output.capabilityDrafts, adapterImplementationTs: output.adapterImplementationTs,
      implementationValidation };
    await this.updateJob(job.id, { status: valid ? 'awaiting_review' : 'invalid', phase: 'complete', ...saved,
      error: valid ? undefined : [...capabilityErrors, ...implementationValidation.errors].join('; ') });
    await this.storage.write(`selector-discovery-implementation-${job.id}`, saved);
  }

  private async getRequiredJob(id: string): Promise<SelectorDiscoveryJob> {
    const job = await this.get(id);
    if (!job) throw new Error(`Discovery job "${id}" was not found.`);
    return job;
  }

  private async updateJob(id: string, patch: Partial<SelectorDiscoveryJob>): Promise<void> {
    const job = await this.getRequiredJob(id);
    await this.saveJob({ ...job, ...patch, updatedAt: new Date().toISOString() });
  }

  private async updateFunctionRevisionTask(
    job: SelectorDiscoveryJob,
    revisionTaskId: string,
    patch: Partial<NonNullable<SelectorDiscoveryJob['functionRevisionTasks']>[number]>
  ): Promise<void> {
    const tasks = (job.functionRevisionTasks ?? []).map((task) => (
      task.id === revisionTaskId
        ? { ...task, ...patch, updatedAt: new Date().toISOString() }
        : task
    ));
    await this.updateJob(job.id, { functionRevisionTasks: tasks });
  }

  private async runFunctionRevision(
    jobId: string, revisionTaskId: string, source: string,
    options: { modelMode?: 'current-settings' | 'previous-task' } = {}
  ): Promise<void> {
    const { job, revisionTask } = await this.beginFunctionRevision(jobId, revisionTaskId);
    const runtime = await this.prepareRevisionRuntime(job, revisionTask, options.modelMode);
    let conversationId: string | undefined;
    try {
      conversationId = await runtime.client.createConversation();
      await this.updateFunctionRevisionTask(runtime.job, revisionTaskId, { conversationId });
      const latest = await this.getRequiredJob(jobId);
      const result = await this.executeFunctionRevision(runtime, conversationId, latest, revisionTask, source);
      await this.saveFunctionRevisionResult(jobId, revisionTaskId, result);
    } catch (error) {
      throw new Error(formatAoFunctionRevisionFailure(error, runtime.settings, runtime.providerDocument));
    } finally {
      if (conversationId) await runtime.client.deleteConversation(conversationId).catch(() => undefined);
    }
  }

  private async beginFunctionRevision(jobId: string, taskId: string) {
    const job = await this.getRequiredJob(jobId);
    const revisionTask = job.functionRevisionTasks?.find((task) => task.id === taskId);
    if (!revisionTask) throw new Error(`Function revision task "${taskId}" was not found.`);
    await this.updateFunctionRevisionTask(job, taskId, { status: 'running', error: undefined });
    return { job, revisionTask };
  }

  private async prepareRevisionRuntime(
    job: SelectorDiscoveryJob, task: RevisionTask, modelMode?: 'current-settings' | 'previous-task'
  ): Promise<RevisionRuntime> {
    const stored = await new SelectorDiscoverySettingsStore(this.storage).getRequired();
    const settings = modelMode === 'previous-task' && task.model && task.aoBaseUrl
      ? { ...stored.settings, model: task.model, aoBaseUrl: task.aoBaseUrl } : stored.settings;
    await this.updateFunctionRevisionTask(job, task.id,
      { model: settings.model, aoBaseUrl: settings.aoBaseUrl });
    return { job: await this.getRequiredJob(job.id), settings,
      providerDocument: stored.providerDocument, client: new AoClient(settings.aoBaseUrl) };
  }

  private async executeFunctionRevision(
    runtime: RevisionRuntime, conversationId: string, job: SelectorDiscoveryJob,
    task: RevisionTask, source: string
  ) {
    const bundle = await this.bundleManager.loadActive(runtime.providerDocument, runtime.settings.model);
    await this.bundleManager.upload(runtime.client, conversationId, bundle);
    await runtime.client.uploadFile(conversationId, 'adapter-implementation.ts', source);
    await runtime.client.uploadFile(conversationId, 'revision-task.md',
      createFunctionRevisionTaskMarkdown(job, task, source));
    await runtime.client.start(conversationId);
    return runAoFunctionRevisionWithRetry({ client: runtime.client, conversationId,
      model: runtime.settings.model, revisionTask: task,
      outputPath: 'outputs/revised-adapter-implementation.ts',
      reviewPath: 'outputs/function-revision-review.md',
      selfCheckPath: 'outputs/function-revision-self-check.md' });
  }

  private async saveFunctionRevisionResult(
    jobId: string, taskId: string,
    result: Awaited<ReturnType<typeof runAoFunctionRevisionWithRetry>>
  ): Promise<void> {
    const job = await this.getRequiredJob(jobId);
    const validation = validateAdapterImplementationDraft(result.revisedSource, { target: job.target ?? 'full' });
    const error = validation.valid ? undefined : validation.errors.join('; ');
    const tasks = (job.functionRevisionTasks ?? []).map((task) => task.id === taskId
      ? { ...task, status: validation.valid ? 'awaiting_review' as const : 'failed' as const,
        error, selfCheckMarkdown: result.selfCheckMarkdown, updatedAt: new Date().toISOString() } : task);
    await this.saveJob({ ...job, adapterImplementationTs: result.revisedSource,
      reviewNotesMarkdown: appendRevisionNotes(job.reviewNotesMarkdown, taskId, result.reviewNotes),
      implementationValidation: validation, status: validation.valid ? 'awaiting_review' : 'invalid',
      error, functionRevisionTasks: tasks, updatedAt: new Date().toISOString() });
  }

  private async saveJob(job: SelectorDiscoveryJob): Promise<void> {
    await this.storage.write(`${JOB_PREFIX}${job.id}`, job);
    const ids = (await this.storage.read<string[]>(INDEX_KEY)) ?? [];
    if (!ids.includes(job.id)) {
      ids.unshift(job.id);
      await this.storage.write(INDEX_KEY, ids.slice(0, 200));
    }
  }

  private createJobId(): string {
    return `disc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async getSafeFetchOptions(sessionId?: string): Promise<{
    browser?: BrowserConfig;
    network?: NetworkConfig;
    renderFirst: boolean;
    renderPage?: (url: string, options: { timeoutMs: number }) => Promise<{ url: string; html: string }>;
  }> {
    const [browser, network] = await Promise.all([
      this.getBrowserConfig?.(sessionId),
      this.getNetworkConfig?.(),
    ]);
    const renderPage = sessionId && this.renderBrowserPage
      ? (url: string, options: { timeoutMs: number }) => this.renderBrowserPage!(sessionId, url, options)
      : undefined;
    return { browser, network, renderFirst: true, renderPage };
  }

  private async promoteImplementationDraft(job: SelectorDiscoveryJob): Promise<AdapterPackageManifest> {
    validatePromotionJob(job);
    const adapter = instantiateAdapterImplementationDraft(job.adapterImplementationTs);
    const registeredAdapter = this.validatePromotionTarget(job, adapter);
    const approvalFixture = this.captureApprovalFixture
      ? await this.captureApprovalFixture({ job, adapter }) : undefined;
    const document = createAdapterPackage({ adapter, implementationTs: job.adapterImplementationTs,
      origin: 'local-generated', sourceDiscoveryId: job.id, approvalFixture,
      validation: job.implementationValidation });
    await this.adapterCatalog.installApproved(document, true);
    if (registeredAdapter) this.adapterRegistry.replace(adapter);
    else this.adapterRegistry.register(adapter);
    await this.persistPromotedAdapter(job, document.manifest);
    return document.manifest;
  }

  private validatePromotionTarget(job: SelectorDiscoveryJob, adapter: IComicAdapter) {
    const registered = this.adapterRegistry.get(adapter.id);
    if (job.promotionMode === 'augment' && job.baseAdapterId && adapter.id !== job.baseAdapterId)
      throw new Error(`Capability supplement must keep existing adapter id "${job.baseAdapterId}", got "${adapter.id}".`);
    if (registered && !(job.promotionMode === 'augment' && job.baseAdapterId === adapter.id))
      throw new Error(`Adapter "${adapter.id}" is already registered.`);
    const domainAdapter = this.findRegisteredAdapterByDomains(adapter.domains);
    if (!registered && domainAdapter && domainAdapter.id !== adapter.id)
      throw new Error(`Domain conflict detected for ${adapter.domains.join(', ')}.`);
    return registered;
  }

  private async persistPromotedAdapter(
    job: SelectorDiscoveryJob, manifest: AdapterPackageManifest
  ): Promise<void> {
    await this.updateJob(job.id, { adapterId: manifest.adapterId, adapterName: manifest.name,
      status: 'promoted', phase: 'complete', error: undefined });
  }

  private findRegisteredAdapterByDomains(domains: string[]): ReturnType<AdapterRegistry['getAll']>[number] | undefined {
    return this.adapterRegistry.getAll().find((adapter) => adapter.domains.some((domain) => domains.includes(domain)));
  }

  private async createExistingAdapterContext(job: SelectorDiscoveryJob): Promise<Parameters<typeof createPhase1TaskMarkdown>[0]['existingAdapter']> {
    if (job.promotionMode !== 'augment' || !job.baseAdapterId) {
      return undefined;
    }
    const adapter = this.adapterRegistry.get(job.baseAdapterId);
    if (!adapter) {
      return undefined;
    }
    return {
      adapterId: adapter.id,
      name: adapter.name,
      capabilities: getAdapterCapabilities(adapter),
      note: 'This is a capability supplement job. Keep the same adapter identity and only add metadata/chapter-list selectors unless image selectors are explicitly revalidated.',
    };
  }

}
