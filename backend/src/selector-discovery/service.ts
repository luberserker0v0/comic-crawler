import type { AdapterRegistry } from '../adapter/registry';
import { getAdapterCapabilities } from '../adapter/registry';
import { AdapterBase } from '../adapter/base';
import { composeChapterImages, composeMetadata } from '../adapter/runtime-composer';
import { DynamicSiteAdapter, type DynamicSiteAdapterManifest } from '../adapter/dynamic-site-adapter';
import {
  ACTIVE_DYNAMIC_ADAPTERS_KEY,
  ACTIVE_IMPLEMENTATION_ADAPTERS_KEY,
} from '../adapter/runtime-state';
import type { AdapterCapabilities, BrowserConfig, IComicAdapter, NetworkConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import { AoClient } from './ao-client';
import { SelectorDiscoveryBundleManager } from './bundle-manager';
import { parseMarkdownCandidate, validateMarkdownCandidate } from './markdown-candidate';
import { validateChapterImageSelectorExtraction, validateSelectorExtraction } from './extraction-validator';
import { fetchSafeHtml, normalizeAndValidateUrl, type SafeHtmlFetchResult } from './safe-fetch';
import { looksLikeAntiBotChallenge } from '../crawler/anti-bot';
import { SelectorDiscoverySettingsStore } from './settings-store';
import { validateAdapterImplementationDraft, validateCapabilityDraft } from './adapter-implementation';
import { instantiateAdapterImplementationDraft } from './adapter-draft-runtime';
import { createChapterOnlyTaskMarkdown, createManifestMarkdown, createPhase1TaskMarkdown, createPhase2TaskMarkdown, extractFallbackChapterUrlFromHtml, validatePhase1Markdown } from './task-markdown';
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
  hasCompleteImageSelectors,
  normalizeComparableText,
  safeAdapterId,
  tryExtractRepresentativeChapterUrl,
  validateMetadataSelectorEvidence,
} from './service-shell-compose';
import {
  DEFAULT_SELECTOR_DISCOVERY_AGENT,
  DEFAULT_SELECTOR_DISCOVERY_MODEL,
  type DiscoveryInput,
  type SelectorDiscoveryOracleComparison,
  type SelectorDiscoveryJob,
  type SelectorDiscoveryCapabilityDraft,
  type SelectorDiscoveryShadowPromotion,
} from './types';

const JOB_PREFIX = 'selector-discovery-job-';
const INDEX_KEY = 'selector-discovery-index';
const SHADOW_PROMOTION_PREFIX = 'selector-discovery-shadow-promotion-';
const CAPABILITY_DRAFT_OUTPUTS: Array<Omit<SelectorDiscoveryCapabilityDraft, 'sourceTs' | 'reviewMarkdown' | 'validation'>> = [
  { stage: 'common-verification', sourcePath: 'outputs/common-verification.ts', reviewPath: 'outputs/common-verification-review.md' },
  { stage: 'metadata', sourcePath: 'outputs/metadata-capability.ts', reviewPath: 'outputs/metadata-review.md' },
  { stage: 'chapter-images', sourcePath: 'outputs/chapter-images-capability.ts', reviewPath: 'outputs/chapter-images-review.md' },
];

export interface ActiveImplementationAdapterRecord {
  adapterId: string;
  name: string;
  domains: string[];
  urlPatterns: string[];
  parseMode: IComicAdapter['parseMode'];
  capabilities: AdapterCapabilities;
  sourceDiscoveryId: string;
  adapterImplementationTs: string;
  promotedAt: string;
}

export type SelectorDiscoveryPromotionResult = DynamicSiteAdapterManifest | ActiveImplementationAdapterRecord;

export class SelectorDiscoveryService {
  private readonly inFlightHosts = new Set<string>();
  private readonly bundleManager: SelectorDiscoveryBundleManager;
  private readonly getBrowserConfig?: () => BrowserConfig | Promise<BrowserConfig>;
  private readonly getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;

  constructor(
    private readonly storage: IStorage,
    private readonly adapterRegistry: AdapterRegistry,
    bundleManagerOrOptions?: SelectorDiscoveryBundleManager | {
      bundleManager?: SelectorDiscoveryBundleManager;
      getBrowserConfig?: () => BrowserConfig | Promise<BrowserConfig>;
      getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
    }
  ) {
    if (bundleManagerOrOptions instanceof SelectorDiscoveryBundleManager) {
      this.bundleManager = bundleManagerOrOptions;
    } else {
      this.bundleManager = bundleManagerOrOptions?.bundleManager ?? new SelectorDiscoveryBundleManager();
      this.getBrowserConfig = bundleManagerOrOptions?.getBrowserConfig;
      this.getNetworkConfig = bundleManagerOrOptions?.getNetworkConfig;
    }
  }

  async create(input: DiscoveryInput): Promise<SelectorDiscoveryJob> {
    const normalizedUrl = normalizeAndValidateUrl(input.url);
    const parsedUrl = new URL(normalizedUrl);
    const matchedAdapter = this.adapterRegistry.findByUrl(normalizedUrl);
    const domainMatchedAdapter = matchedAdapter ?? this.adapterRegistry.findByUrlDomain(normalizedUrl);
    const target = input.target ?? 'full';
    const canAugmentMatchedAdapter = Boolean(
      domainMatchedAdapter &&
      target === 'full' &&
      !adapterSupportsDiscoveryTarget(domainMatchedAdapter, target) &&
      getAdapterCapabilities(domainMatchedAdapter).chapterImages
    );
    const now = new Date().toISOString();

    if (matchedAdapter && !input.forceDiscovery && adapterSupportsDiscoveryTarget(matchedAdapter, target)) {
      const job: SelectorDiscoveryJob = {
        id: this.createJobId(),
        url: input.url,
        normalizedUrl,
        hostname: parsedUrl.hostname,
        status: 'known_adapter',
          target,
          promotionMode: 'create',
          adapterId: matchedAdapter.id,
        adapterName: matchedAdapter.name,
        phase: 'known_adapter',
        createdAt: now,
        updatedAt: now,
      };
      await this.saveJob(job);
      return job;
    }

    if (this.inFlightHosts.has(parsedUrl.hostname)) {
      const existing = (await this.list()).find((job) =>
        job.hostname === parsedUrl.hostname && ['queued', 'running'].includes(job.status)
      );
      if (existing) return existing;
    }

    const settingsStore = new SelectorDiscoverySettingsStore(this.storage);
    const hasInlineConfiguration = Boolean(input.providerDocument && input.aoBaseUrl && input.model);
    if (!hasInlineConfiguration) {
      const settings = await settingsStore.getSummary();
      if (!settings.configured) {
        const job: SelectorDiscoveryJob = {
          id: this.createJobId(),
          url: input.url,
          normalizedUrl,
          hostname: parsedUrl.hostname,
          status: 'configuration_required',
          target,
          promotionMode: canAugmentMatchedAdapter ? 'augment' : 'create',
          baseAdapterId: canAugmentMatchedAdapter ? domainMatchedAdapter?.id : undefined,
          error: 'Selector discovery is not configured. Configure AO URL, provider JSON, and model in Settings before this adapter build task can run.',
          createdAt: now,
          updatedAt: now,
        };
        await this.saveJob(job);
        return job;
      }
    }

    const job: SelectorDiscoveryJob = {
      id: this.createJobId(),
      url: input.url,
      normalizedUrl,
      hostname: parsedUrl.hostname,
      status: 'queued',
      target,
      promotionMode: canAugmentMatchedAdapter ? 'augment' : 'create',
      baseAdapterId: canAugmentMatchedAdapter ? domainMatchedAdapter?.id : undefined,
      model: input.model,
      aoBaseUrl: input.aoBaseUrl,
      stopAfterStage: input.stopAfterStage,
      inputSource: input.htmlSnapshot ? 'html-snapshot' : 'live-fetch',
      createdAt: now,
      updatedAt: now,
    };
    await this.saveJob(job);

    void this.run(job.id, input).catch(async (error) => {
      const failed = await this.get(job.id);
      if (failed) {
        failed.status = 'failed';
        failed.error = error instanceof Error ? error.message : String(error);
        failed.updatedAt = new Date().toISOString();
        await this.saveJob(failed);
      }
    });

    return job;
  }

  async retry(id: string): Promise<SelectorDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    return this.create({ url: job.normalizedUrl, target: job.target, forceDiscovery: job.promotionMode === 'augment' || Boolean(job.baseAdapterId) });
  }

  async loadActiveDynamicAdapters(): Promise<void> {
    const manifests = (await this.storage.read<DynamicSiteAdapterManifest[]>(ACTIVE_DYNAMIC_ADAPTERS_KEY)) ?? [];
    const retainedManifests: DynamicSiteAdapterManifest[] = [];
    for (const manifest of manifests) {
      const existingDomainAdapter = this.findRegisteredAdapterByDomains(manifest.domains);
      if (this.adapterRegistry.has(manifest.adapterId)) {
        retainedManifests.push(manifest);
        continue;
      }
      if (existingDomainAdapter && existingDomainAdapter.id !== manifest.adapterId) {
        continue;
      }
      this.adapterRegistry.register(new DynamicSiteAdapter(manifest));
      retainedManifests.push(manifest);
    }
    if (retainedManifests.length !== manifests.length) {
      await this.storage.write(ACTIVE_DYNAMIC_ADAPTERS_KEY, retainedManifests);
    }

    const implementationRecords = (await this.storage.read<ActiveImplementationAdapterRecord[]>(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY)) ?? [];
    const retainedImplementationRecords: ActiveImplementationAdapterRecord[] = [];
    for (const record of implementationRecords) {
      try {
        const adapter = instantiateAdapterImplementationDraft(record.adapterImplementationTs);
        const existingDomainAdapter = this.findRegisteredAdapterByDomains(adapter.domains);
        if (this.adapterRegistry.has(adapter.id)) {
          retainedImplementationRecords.push(record);
          continue;
        }
        if (existingDomainAdapter && existingDomainAdapter.id !== adapter.id) {
          continue;
        }
        this.adapterRegistry.register(adapter);
        retainedImplementationRecords.push({
          ...record,
          adapterId: adapter.id,
          name: adapter.name,
          domains: adapter.domains,
          parseMode: adapter.parseMode,
          capabilities: getAdapterCapabilities(adapter),
        });
      } catch {
        continue;
      }
    }
    if (retainedImplementationRecords.length !== implementationRecords.length) {
      await this.storage.write(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY, retainedImplementationRecords);
    }
  }

  async promote(id: string): Promise<SelectorDiscoveryPromotionResult> {
    const job = await this.getRequiredJob(id);
    if (!job.parsedCandidate && job.adapterImplementationTs?.trim()) {
      return this.promoteImplementationDraft(job);
    }

    const manifest = this.createManifestFromJob(job);
    const adapterId = manifest.adapterId;
    const manifests = (await this.storage.read<DynamicSiteAdapterManifest[]>(ACTIVE_DYNAMIC_ADAPTERS_KEY)) ?? [];
    if (job.promotionMode === 'augment') {
      const baseAdapterId = job.baseAdapterId;
      if (!baseAdapterId) {
        throw new Error('Augment promotion requires a base adapter id.');
      }
      if (adapterId !== baseAdapterId) {
        throw new Error(`Capability supplement must keep existing adapter id "${baseAdapterId}", got "${adapterId}".`);
      }
      if (!this.adapterRegistry.has(baseAdapterId)) {
        throw new Error(`Base adapter "${baseAdapterId}" is not registered.`);
      }

      const merged = this.mergeManifestWithBase(manifest, manifests, baseAdapterId);
      this.adapterRegistry.replace(new DynamicSiteAdapter(merged));
      await this.storage.write(ACTIVE_DYNAMIC_ADAPTERS_KEY, [...manifests.filter((item) => item.adapterId !== baseAdapterId), merged]);
      await this.updateJob(id, {
        adapterId: baseAdapterId,
        adapterName: merged.name,
        status: 'promoted',
        phase: 'complete',
        error: undefined,
      });
      return merged;
    }

    if (this.adapterRegistry.has(adapterId)) {
      throw new Error(`Adapter "${adapterId}" is already registered.`);
    }

    const domains = manifest.domains;
    if (this.adapterRegistry.list().some((adapter) => adapter.domains.some((domain) => domains.includes(domain)))) {
      throw new Error(`Domain conflict detected for ${domains.join(', ')}.`);
    }

    this.adapterRegistry.register(new DynamicSiteAdapter(manifest));
    await this.storage.write(ACTIVE_DYNAMIC_ADAPTERS_KEY, [...manifests.filter((item) => item.adapterId !== adapterId), manifest]);
    await this.updateJob(id, {
      adapterId,
      adapterName: manifest.name,
      status: 'promoted',
      phase: 'complete',
      error: undefined,
    });
    return manifest;
  }

  async shadowPromote(id: string): Promise<SelectorDiscoveryJob> {
    let job = await this.getRequiredJob(id);
    const manifest = this.createManifestFromJob(job);
    if (!job.extractionValidation?.valid) {
      job = await this.validateCandidate(id);
    }

    const oracleComparison = await this.compareWithBuiltInOracle(job);
    const storageKey = `${SHADOW_PROMOTION_PREFIX}${id}`;
    const shadowPromotion: SelectorDiscoveryShadowPromotion = {
      id: `shadow-${id}`,
      jobId: id,
      createdAt: new Date().toISOString(),
      manifestAdapterId: manifest.adapterId,
      manifestName: manifest.name,
      domains: manifest.domains,
      storageKey,
      note: 'Stored for bundle evaluation only. Runtime adapter registry was not modified.',
    };

    await this.storage.write(storageKey, {
      shadowPromotion,
      manifest,
      oracleComparison,
      candidateMarkdown: job.candidateMarkdown,
      parsedCandidate: job.parsedCandidate,
    });
    await this.updateJob(id, { shadowPromotion, oracleComparison });
    return this.getRequiredJob(id);
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
    const source = input.currentSource?.trim() || job.adapterImplementationTs?.trim();
    if (!source) {
      throw new Error('Discovery job has no TypeScript implementation draft to revise.');
    }
    if (!input.instruction.trim()) {
      throw new Error('Revision instruction is required.');
    }
    const now = new Date().toISOString();
    const revisionTask = {
      id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      parentDiscoveryId: job.id,
      functionId: input.functionId,
      instruction: input.instruction.trim(),
      status: 'queued' as const,
      createdAt: now,
      updatedAt: now,
    };
    await this.updateJob(job.id, {
      functionRevisionTasks: [...(job.functionRevisionTasks ?? []), revisionTask],
    });
    void this.runFunctionRevision(job.id, revisionTask.id, source).catch(async (error) => {
      const latest = await this.get(job.id);
      if (!latest) return;
      await this.updateFunctionRevisionTask(latest, revisionTask.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
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
    if (!revisionTask) {
      throw new Error(`Function revision task "${input.revisionTaskId}" was not found.`);
    }
    if (revisionTask.status === 'running') {
      throw new Error(`Function revision task "${input.revisionTaskId}" is already running.`);
    }
    const source = input.currentSource?.trim() || job.adapterImplementationTs?.trim();
    if (!source) {
      throw new Error('Discovery job has no TypeScript implementation draft to revise.');
    }
    await this.updateFunctionRevisionTask(job, input.revisionTaskId, {
      status: 'queued',
      error: undefined,
    });
    void this.runFunctionRevision(job.id, input.revisionTaskId, source, {
      modelMode: input.modelMode ?? 'current-settings',
    }).catch(async (error) => {
      const latest = await this.get(job.id);
      if (!latest) return;
      await this.updateFunctionRevisionTask(latest, input.revisionTaskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return this.getRequiredJob(job.id);
  }

  async revalidate(id: string): Promise<SelectorDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    if (!job.candidateMarkdown) {
      throw new Error('Discovery job has no candidate Markdown to revalidate.');
    }

    const validation = validateMarkdownCandidate(job.candidateMarkdown, { target: job.target });
    const parsedCandidate = parseMarkdownCandidate(job.candidateMarkdown);
    await this.updateJob(id, {
      status: validation.valid ? 'awaiting_review' : 'invalid',
      parsedCandidate,
      validation,
      error: validation.valid ? undefined : job.error,
    });
    return this.getRequiredJob(id);
  }

  async validateCandidate(id: string): Promise<SelectorDiscoveryJob> {
    const job = await this.getRequiredJob(id);
    if (!job.parsedCandidate?.selectors) {
      throw new Error('Discovery job has no parsed candidate selectors to validate.');
    }

    const extractionValidation = job.target === 'chapter-only'
      ? await validateChapterImageSelectorExtraction({
          chapterUrl: job.normalizedUrl,
          selectors: job.parsedCandidate.selectors,
        })
      : await validateSelectorExtraction({
          metadataUrl: job.normalizedUrl,
          selectors: job.parsedCandidate.selectors as any,
        });
    await this.updateJob(id, { extractionValidation });
    return this.getRequiredJob(id);
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
    await this.storage.delete(`selector-discovery-manifest-${id}`);
    await this.storage.delete(`${SHADOW_PROMOTION_PREFIX}${id}`);
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
      const settingsStore = new SelectorDiscoverySettingsStore(this.storage);
      const configured = input.providerDocument && input.aoBaseUrl && input.model
        ? {
            settings: {
              aoBaseUrl: input.aoBaseUrl,
              model: input.model,
              providerFingerprint: 'transient',
              providerIds: [],
              modelIds: [],
              configuredAt: new Date().toISOString(),
            },
            providerDocument: input.providerDocument,
          }
        : await settingsStore.getRequired();

      const aoBaseUrl = input.aoBaseUrl ?? configured.settings.aoBaseUrl;
      const model = input.model ?? configured.settings.model ?? DEFAULT_SELECTOR_DISCOVERY_MODEL;
      const providerDocument = input.providerDocument ?? configured.providerDocument;
      const safeFetchOptions = await this.getSafeFetchOptions();
      if (input.htmlSnapshot) {
        await this.runFromHtmlSnapshot(job, input, {
          aoBaseUrl,
          model,
          providerDocument,
        });
        return;
      }
      const client = new AoClient(aoBaseUrl);
      const bundle = await this.bundleManager.loadActive(providerDocument, model);
      if (job.target === 'chapter-only') {
        const chapterFetch = await fetchSafeHtml(job.normalizedUrl, safeFetchOptions);
        await this.runChapterOnlyDiscovery(job, {
          client,
          bundle,
          model,
          aoBaseUrl,
          chapterFetch,
          phase1Markdown: createChapterOnlyPhase1Markdown(chapterFetch.finalUrl),
        });
        return;
      }
      const metadataFetch = await fetchSafeHtml(job.normalizedUrl, safeFetchOptions);
      const existingAdapterContext = await this.createExistingAdapterContext(job);
      const phase1OutputPath = 'outputs/phase1-output.md';
      const phase1 = await this.runAoPhase(client, bundle, model, createPhase1TaskMarkdown({
        url: job.normalizedUrl,
        metadataFetch,
        existingAdapter: existingAdapterContext,
      }), phase1OutputPath, {
        validate: validatePhase1Markdown,
      });
      const phase1Validation = validatePhase1Markdown(phase1);
      if (!phase1Validation.valid) {
        await this.updateJob(job.id, {
          status: 'invalid',
          phase: 'complete',
          phase1Markdown: phase1,
          model,
          aoBaseUrl,
          error: formatAoPhaseFailureError({
            outputPath: phase1OutputPath,
            model,
            errors: phase1Validation.errors,
            emptyOutput: !phase1.trim(),
          }),
        });
        return;
      }

      await this.updateJob(job.id, { phase1Markdown: phase1, phase: 'phase2', model, aoBaseUrl });
      const chapterUrl = tryExtractRepresentativeChapterUrl(phase1, metadataFetch.finalUrl)
        ?? extractFallbackChapterUrlFromHtml(metadataFetch.html, metadataFetch.finalUrl);
      if (!chapterUrl) {
        throw new Error('Phase 1 output did not include a Representative Chapter URL and no fallback chapter link was found.');
      }
      const chapterFetch = await fetchSafeHtml(chapterUrl, safeFetchOptions);
      const phase2TaskMarkdown = createPhase2TaskMarkdown({
        url: job.normalizedUrl,
        phase1Markdown: phase1,
        chapterFetch,
        existingAdapter: existingAdapterContext,
      });
      const implementation = await this.runAoImplementationPhase(job, client, bundle, model, phase2TaskMarkdown, input.stopAfterStage);

      await this.finalizeImplementationDraft(job, implementation);
    } finally {
      this.inFlightHosts.delete(job.hostname);
    }
  }

  private async runAoPhase(
    client: AoClient,
    bundle: Awaited<ReturnType<SelectorDiscoveryBundleManager['loadActive']>>,
    model: string,
    taskMarkdown: string,
    outputPath: string,
    options: {
      validate?: (markdown: string) => { valid: boolean; errors: string[] };
    } = {}
  ): Promise<string> {
    let lastOutput = '';
    let retryFeedback = '';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const conversationId = await client.createConversation();
      try {
        await this.bundleManager.upload(client, conversationId, bundle);
        await client.uploadFile(conversationId, 'task.md', taskMarkdown);
        await client.start(conversationId);
        const response = await client.message(
          conversationId,
          `${taskMarkdown}

## Required AO Output

Write the full Markdown result to ${outputPath}.

Also return the same Markdown result in your chat response. Do not only summarize. Do not output JSON.

Use the exact Markdown headings required by the referenced contract file. Do not rename, decorate, or add parenthetical suffixes to required headings. If this is the final candidate, the first required section must be exactly "## Adapter Identity".
${retryFeedback}`,
          model,
          DEFAULT_SELECTOR_DISCOVERY_AGENT
        );
        const output = await client.readFile(conversationId, outputPath).catch(() => '');
        lastOutput = output.trim() || response.text?.trim() || '';
        const validation = options.validate?.(lastOutput);
        if (!options.validate || validation?.valid) {
          return lastOutput;
        }
        if (attempt < 2 && validation) {
          retryFeedback = createAoPhaseRetryFeedback(outputPath, lastOutput, validation.errors);
        }
      } finally {
        await client.deleteConversation(conversationId).catch(() => undefined);
      }
    }
    return lastOutput;
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
      const latest = capabilityDrafts.at(-1);
      if (!latest) {
        continue;
      }
      if (latest?.validation && !latest.validation.valid) {
        return {
          adapterImplementationTs: '',
          reviewNotesMarkdown: formatCapabilityDraftFailureReview(capabilityDrafts),
          capabilityDrafts,
        };
      }
      if (stopAfterStage === latest.stage) {
        return {
          adapterImplementationTs: '',
          reviewNotesMarkdown: formatCapabilityStageSmokeReview(capabilityDrafts),
          capabilityDrafts,
        };
      }
    }
    await this.updateJob(job.id, { phase: 'compose', capabilityDrafts });
    const composed = composeAdapterShellFromCapabilities(job, capabilityDrafts);
    return {
      ...composed,
      capabilityDrafts,
    };
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
    client: AoClient,
    bundle: Awaited<ReturnType<SelectorDiscoveryBundleManager['loadActive']>>,
    model: string,
    taskMarkdown: string,
    draft: Omit<SelectorDiscoveryCapabilityDraft, 'sourceTs' | 'reviewMarkdown' | 'validation'>,
    job: SelectorDiscoveryJob,
    target?: 'full' | 'chapter-only',
    retryFeedback?: string
  ): Promise<SelectorDiscoveryCapabilityDraft> {
    const conversationId = await client.createConversation();
    try {
      await this.bundleManager.upload(client, conversationId, bundle);
      await client.uploadFile(conversationId, 'task.md', taskMarkdown);
      await client.start(conversationId);
      const concreteCommonVerificationSkeleton = draft.stage === 'common-verification'
        ? createCommonVerificationSkeleton(job.normalizedUrl, job.hostname)
        : '';
      const concreteMetadataSkeleton = draft.stage === 'metadata'
        ? createMetadataSkeleton(job.hostname)
        : '';
      const templateInstruction = draft.stage === 'common-verification'
        ? `

Common/verification stage has a strict capability-only boundary:

- Use task.md only for site context and evidence.
- Use contracts/common-verification-template.ts only for TypeScript structure.
- Do not use contracts/adapter-base-api.md for this stage.
- Write ${draft.sourcePath} by copying the skeleton below and replacing only
  URL matching and verification keywords if needed.
- The output must keep the same imports, class shape, and method names as this
  skeleton.
- The source must include this hostname exactly: ${job.hostname}
- Do not leave example.com, my-site-adapter, Generic Comic Site, or Example Site
  anywhere in the source.
- Do not declare AdapterBase, CommonCapability, VerificationCapability, DOM,
  Document, enum ParseMode, interfaces, or any framework types.
- Do not export or implement an AdapterBase shell.
- Do not declare id, name, domains, parseMode, capabilities, common,
  verification, metadata, chapterImages, constructor, or super().
- Do not add verifyDom, extractTitle, extractAuthor, extractChapterList,
  extractChapterImageUrls, placeholder extraction methods, or sample data.

\`\`\`ts
${concreteCommonVerificationSkeleton}
\`\`\``
        : draft.stage === 'metadata'
          ? `

Metadata stage has a strict single-capability boundary:

- Use task.md for trusted metadata DOM evidence and Phase 1 analysis.
- Use contracts/metadata-template.ts only for TypeScript structure.
- Do not use contracts/common-verification-template.ts for this stage.
- Write ${draft.sourcePath} by copying the skeleton below and replacing
  selectors, cleanup logic, URL filters, and status keywords with site-specific
  behavior from task.md.
- The skeleton selectors are placeholders. Do not keep three or more of these
  unchanged selectors: main h1, .author a, .description, .cover img, .tags a,
  .status, .chapter-list a[href*="/read/"].
- The skeleton throws placeholder errors. Replace every throw with working
  extraction code using selectors from task.md.
- Keep exactly one site-specific MetadataCapability subclass.
- Do not export an AdapterBase shell.
- Do not implement CommonCapability, VerificationCapability, or
  ChapterImagesCapability in this file.
- Do not implement extractChapterImageUrls, fetchMetadata, or
  fetchChapterImages.
- Before writing extractStatus or extractChapterList, read the Runtime DTO field
  semantics in contracts/adapter-base-api.md. ChapterInfo requires id, title,
  and absolute url; do not fill status/sourceUrl/placeholder dates.
- extractChapterList must return the full catalog available in the trusted DOM,
  not a preview, sample, recommendation list, or first few chapters.

\`\`\`ts
${concreteMetadataSkeleton}
\`\`\``
        : '';
      const response = await client.message(
        conversationId,
        `# Capability Stage Task

Read task.md and only the contract files needed for this capability stage.

## Required AO Output

Produce only the ${draft.stage} capability draft.

Write TypeScript capability source to ${draft.sourcePath}.
Write human review notes for this capability to ${draft.reviewPath}.

Important file-writing rules:

- The TypeScript source must be written to ${draft.sourcePath}, not embedded
  inside ${draft.reviewPath}.
- The review notes must be Markdown prose only. Do not put the full TypeScript
  source in the review notes.
- Do not import from contracts/adapter-base-api.md or any contracts path.
- For common-verification, use the concrete skeleton in this message as the
  exact source shape.
- For metadata, use the concrete skeleton in this message as the exact source
  shape.
- For later stages, use the exact signatures documented in
  contracts/adapter-base-api.md.

Do not write outputs/adapter-implementation.ts.
Do not compose the final adapter in this stage. ComicCrawler composes the
AdapterBase shell after capability review.
Do not output JSON.

Stage rules:

- common-verification: write one CommonCapability subclass and one separate
  VerificationCapability subclass. Do not write an AdapterBase shell. Do not
  combine them with implements. Do not write constructor() or call super().
- metadata: write only one MetadataCapability subclass.
- chapter-images: write only one ChapterImagesCapability subclass.
- Every method must use the exact signature documented for this capability
  stage.
${templateInstruction}
${retryFeedback ? `
## Retry Feedback

${retryFeedback}
` : ''}

Chat response rule:

- After writing both files, reply with one short sentence confirming the two
  file paths.
- Do not include the TypeScript source in chat.`,
        model,
        DEFAULT_SELECTOR_DISCOVERY_AGENT
      );
      const [sourceTs, reviewMarkdown] = await Promise.all([
        client.readFile(conversationId, draft.sourcePath).catch(() => ''),
        client.readFile(conversationId, draft.reviewPath).catch(() => ''),
      ]);
      const reviewText = reviewMarkdown.trim();
      const chatText = response.text?.trim() || '';
      const trimmedSource = sourceTs.trim()
        || extractFirstTypeScriptFence(reviewText)
        || extractFirstTypeScriptFence(chatText);
      const validation = validateCapabilityDraft(trimmedSource, { stage: draft.stage, target });
      if (draft.stage === 'common-verification' && trimmedSource && !trimmedSource.includes(job.hostname)) {
        validation.errors.push(`Common/verification draft must include target hostname "${job.hostname}".`);
        validation.valid = false;
      }
      if (draft.stage === 'metadata' && trimmedSource) {
        const evidenceErrors = validateMetadataSelectorEvidence(trimmedSource, taskMarkdown);
        if (evidenceErrors.length > 0) {
          validation.errors.push(...evidenceErrors);
          validation.valid = false;
        }
      }
      return {
        ...draft,
        sourceTs: trimmedSource,
        reviewMarkdown: reviewText || chatText,
        validation,
      };
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
    if (job.target !== 'chapter-only') {
      throw new Error('HTML snapshot discovery currently supports chapter-only targets.');
    }
    const snapshot = input.htmlSnapshot;
    if (!snapshot?.html?.trim()) {
      throw new Error('HTML snapshot is required.');
    }
    if (snapshot.html.length > 2_000_000) {
      throw new Error('HTML snapshot is too large. Maximum size is 2,000,000 characters.');
    }
    if (looksLikeAntiBotChallenge(snapshot.html)) {
      throw new Error('HTML snapshot still looks like an anti-bot challenge or blocked page. Open the real chapter page after verification, then capture the rendered comic DOM.');
    }

    const finalUrl = normalizeAndValidateUrl(snapshot.finalUrl ?? job.normalizedUrl);
    const chapterFetch: SafeHtmlFetchResult = {
      url: job.normalizedUrl,
      finalUrl,
      redirectChain: [],
      html: snapshot.html,
      contentType: 'text/html; source=user-snapshot',
    };
    const phase1 = `# Phase 1 Result

## Site Decision

- Snapshot source: user-provided rendered chapter HTML.
- Discovery target: chapter-only adapter.

## Title Extraction

- Not required for chapter-only discovery.

## Chapter List Extraction

- Not required for chapter-only discovery.

## Representative Chapter URL

${finalUrl}

## Evidence

- The user supplied a verified browser HTML snapshot for the target chapter page.
- Backend rejected challenge/blocked snapshots before AO analysis.

## Uncertainty

- Metadata and chapter list extraction are intentionally out of scope for chapter-only discovery.
`;
    const client = new AoClient(configured.aoBaseUrl);
    const bundle = await this.bundleManager.loadActive(configured.providerDocument, configured.model);
    await this.runChapterOnlyDiscovery(job, {
      client,
      bundle,
      model: configured.model,
      aoBaseUrl: configured.aoBaseUrl,
      chapterFetch,
      phase1Markdown: phase1,
    });
  }

  private async runChapterOnlyDiscovery(
    job: SelectorDiscoveryJob,
    input: {
      client: AoClient;
      bundle: Awaited<ReturnType<SelectorDiscoveryBundleManager['loadActive']>>;
      model: string;
      aoBaseUrl: string;
      chapterFetch: SafeHtmlFetchResult;
      phase1Markdown: string;
    }
  ): Promise<void> {
    await this.updateJob(job.id, {
      phase1Markdown: input.phase1Markdown,
      phase: 'phase2',
      model: input.model,
      aoBaseUrl: input.aoBaseUrl,
    });
    const implementation = await this.runAoImplementationPhase(
      job,
      input.client,
      input.bundle,
      input.model,
      createChapterOnlyTaskMarkdown({
        url: job.normalizedUrl,
        chapterFetch: input.chapterFetch,
      })
    );
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
    const stageSmokeComplete = Boolean(job.stopAfterStage && output.capabilityDrafts?.some((draft) => draft.stage === job.stopAfterStage));
    const implementationValidation = stageSmokeComplete
      ? { valid: capabilityErrors.length === 0, errors: [], warnings: [], syntaxValid: true }
      : validateAdapterImplementationDraft(output.adapterImplementationTs, {
          target: job.target,
        });
    const valid = capabilityErrors.length === 0 && implementationValidation.valid;
    await this.updateJob(job.id, {
      status: valid ? 'awaiting_review' : 'invalid',
      phase: 'complete',
      reviewNotesMarkdown: output.reviewNotesMarkdown,
      capabilityDrafts: output.capabilityDrafts,
      adapterImplementationTs: output.adapterImplementationTs,
      implementationValidation,
      error: valid ? undefined : [...capabilityErrors, ...implementationValidation.errors].join('; '),
    });
    await this.storage.write(`selector-discovery-implementation-${job.id}`, {
      reviewNotesMarkdown: output.reviewNotesMarkdown,
      capabilityDrafts: output.capabilityDrafts,
      adapterImplementationTs: output.adapterImplementationTs,
      implementationValidation,
    });
  }

  private async finalizeCandidate(job: SelectorDiscoveryJob, candidateMarkdown: string): Promise<void> {
    const validation = validateMarkdownCandidate(candidateMarkdown, {
      target: job.target,
      allowExistingImageSelectors: job.promotionMode === 'augment',
    });
    const parsedCandidate = parseMarkdownCandidate(candidateMarkdown);
    const manifestMarkdown = createManifestMarkdown(parsedCandidate);
    await this.updateJob(job.id, {
      status: validation.valid ? 'awaiting_review' : 'invalid',
      phase: 'complete',
      candidateMarkdown,
      parsedCandidate,
      validation,
    });
    await this.storage.write(`selector-discovery-manifest-${job.id}`, { markdown: manifestMarkdown, parsedCandidate });
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
    jobId: string,
    revisionTaskId: string,
    source: string,
    options: { modelMode?: 'current-settings' | 'previous-task' } = {}
  ): Promise<void> {
    let job = await this.getRequiredJob(jobId);
    const revisionTask = job.functionRevisionTasks?.find((task) => task.id === revisionTaskId);
    if (!revisionTask) {
      throw new Error(`Function revision task "${revisionTaskId}" was not found.`);
    }
    await this.updateFunctionRevisionTask(job, revisionTaskId, { status: 'running', error: undefined });
    job = await this.getRequiredJob(jobId);

    const settingsStore = new SelectorDiscoverySettingsStore(this.storage);
    const { settings: storedSettings, providerDocument } = await settingsStore.getRequired();
    const settings = options.modelMode === 'previous-task' && revisionTask.model && revisionTask.aoBaseUrl
      ? { ...storedSettings, model: revisionTask.model, aoBaseUrl: revisionTask.aoBaseUrl }
      : storedSettings;
    await this.updateFunctionRevisionTask(job, revisionTaskId, {
      model: settings.model,
      aoBaseUrl: settings.aoBaseUrl,
    });
    job = await this.getRequiredJob(jobId);
    const client = new AoClient(settings.aoBaseUrl);
    let conversationId: string | undefined;
    const outputPath = 'outputs/revised-adapter-implementation.ts';
    const reviewPath = 'outputs/function-revision-review.md';
    const selfCheckPath = 'outputs/function-revision-self-check.md';
    try {
      const bundle = await this.bundleManager.loadActive(providerDocument, settings.model);
      conversationId = await client.createConversation();
      await this.updateFunctionRevisionTask(job, revisionTaskId, { conversationId });
      job = await this.getRequiredJob(jobId);
      await this.bundleManager.upload(client, conversationId, bundle);
      await client.uploadFile(conversationId, 'adapter-implementation.ts', source);
      await client.uploadFile(conversationId, 'revision-task.md', createFunctionRevisionTaskMarkdown(job, revisionTask, source));
      await client.start(conversationId);
      const revisionResult = await runAoFunctionRevisionWithRetry({
        client,
        conversationId,
        model: settings.model,
        revisionTask,
        outputPath,
        reviewPath,
        selfCheckPath,
      });
      const validation = validateAdapterImplementationDraft(revisionResult.revisedSource, {
        target: job.target ?? 'full',
      });
      job = await this.getRequiredJob(jobId);
      await this.saveJob({
        ...job,
        adapterImplementationTs: revisionResult.revisedSource,
        reviewNotesMarkdown: [
          job.reviewNotesMarkdown,
          '',
          `# Function Revision ${revisionTask.id}`,
          '',
          revisionResult.reviewNotes,
        ].filter(Boolean).join('\n'),
        implementationValidation: validation,
        status: validation.valid ? 'awaiting_review' : 'invalid',
        error: validation.valid ? undefined : validation.errors.join('; '),
        functionRevisionTasks: (job.functionRevisionTasks ?? []).map((task) => (
          task.id === revisionTaskId
            ? {
                ...task,
                status: validation.valid ? 'awaiting_review' : 'failed',
                error: validation.valid ? undefined : validation.errors.join('; '),
                selfCheckMarkdown: revisionResult.selfCheckMarkdown,
                updatedAt: new Date().toISOString(),
              }
            : task
        )),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      throw new Error(formatAoFunctionRevisionFailure(error, settings, providerDocument));
    } finally {
      if (conversationId) {
        await client.deleteConversation(conversationId).catch(() => undefined);
      }
    }
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

  private async getSafeFetchOptions(): Promise<{ browser?: BrowserConfig; network?: NetworkConfig }> {
    const [browser, network] = await Promise.all([
      this.getBrowserConfig?.(),
      this.getNetworkConfig?.(),
    ]);
    return { browser, network };
  }

  private async promoteImplementationDraft(job: SelectorDiscoveryJob): Promise<ActiveImplementationAdapterRecord> {
    if (job.status !== 'awaiting_review') {
      throw new Error('Only awaiting_review discovery jobs can be promoted.');
    }
    if (!job.adapterImplementationTs?.trim()) {
      throw new Error('Discovery job has no adapter implementation draft.');
    }
    if (!job.implementationValidation?.valid) {
      const errors = job.implementationValidation?.errors?.join('; ') || 'implementation validation did not pass';
      throw new Error(`Adapter implementation draft is invalid: ${errors}`);
    }

    const adapter = instantiateAdapterImplementationDraft(job.adapterImplementationTs);
    const adapterId = adapter.id;
    if (job.promotionMode === 'augment' && job.baseAdapterId && adapterId !== job.baseAdapterId) {
      throw new Error(`Capability supplement must keep existing adapter id "${job.baseAdapterId}", got "${adapterId}".`);
    }

    if (this.adapterRegistry.has(adapterId)) {
      if (job.promotionMode === 'augment' && job.baseAdapterId === adapterId) {
        this.adapterRegistry.replace(adapter);
      } else {
        throw new Error(`Adapter "${adapterId}" is already registered.`);
      }
    } else {
      const existingDomainAdapter = this.findRegisteredAdapterByDomains(adapter.domains);
      if (existingDomainAdapter && existingDomainAdapter.id !== adapterId) {
        throw new Error(`Domain conflict detected for ${adapter.domains.join(', ')}.`);
      }
      this.adapterRegistry.register(adapter);
    }

    const record: ActiveImplementationAdapterRecord = {
      adapterId,
      name: adapter.name,
      domains: adapter.domains,
      urlPatterns: adapter.domains.map((domain) => `https://${domain}/*`),
      parseMode: adapter.parseMode,
      capabilities: getAdapterCapabilities(adapter),
      sourceDiscoveryId: job.id,
      adapterImplementationTs: job.adapterImplementationTs,
      promotedAt: new Date().toISOString(),
    };
    const records = (await this.storage.read<ActiveImplementationAdapterRecord[]>(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY)) ?? [];
    await this.storage.write(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY, [
      ...records.filter((item) => item.adapterId !== adapterId),
      record,
    ]);
    await this.updateJob(job.id, {
      adapterId,
      adapterName: adapter.name,
      status: 'promoted',
      phase: 'complete',
      error: undefined,
    });
    return record;
  }

  private createManifestFromJob(job: SelectorDiscoveryJob): DynamicSiteAdapterManifest {
    if (job.status !== 'awaiting_review' || !job.parsedCandidate) {
      throw new Error('Only awaiting_review discovery jobs can be promoted.');
    }

    const target = job.target ?? 'full';
    const selectors = job.parsedCandidate.selectors;
    if (!hasCompleteImageSelectors(selectors.images) && job.promotionMode !== 'augment') {
      throw new Error('Candidate image selectors are incomplete.');
    }
    if (target === 'full' && (!selectors.metadata || !selectors.chapters)) {
      throw new Error('Candidate metadata/chapter selectors are incomplete.');
    }

    if (job.promotionMode === 'augment' && job.baseAdapterId && job.parsedCandidate.adapterId) {
      const candidateAdapterId = safeAdapterId(job.parsedCandidate.adapterId);
      if (candidateAdapterId !== job.baseAdapterId) {
        throw new Error(`Capability supplement must keep existing adapter id "${job.baseAdapterId}", got "${candidateAdapterId}".`);
      }
    }

    const adapterId = safeAdapterId(job.promotionMode === 'augment'
      ? job.baseAdapterId ?? job.parsedCandidate.adapterId ?? job.hostname
      : job.parsedCandidate.adapterId ?? job.hostname);
    return {
      adapterId,
      name: job.parsedCandidate.name ?? adapterId,
      domains: job.parsedCandidate.domains.length > 0 ? job.parsedCandidate.domains : [job.hostname],
      urlPatterns: job.parsedCandidate.urlPatterns,
      capabilities: target === 'chapter-only'
        ? { verification: true, metadata: false, chapterImages: true }
        : { verification: true, metadata: true, chapterImages: true },
      selectors: selectors as DynamicSiteAdapterManifest['selectors'],
      sourceDiscoveryId: job.id,
      promotedAt: new Date().toISOString(),
    };
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
    const manifests = (await this.storage.read<DynamicSiteAdapterManifest[]>(ACTIVE_DYNAMIC_ADAPTERS_KEY)) ?? [];
    const manifest = manifests.find((item) => item.adapterId === job.baseAdapterId);
    return {
      adapterId: adapter.id,
      name: adapter.name,
      capabilities: getAdapterCapabilities(adapter),
      imageSelectors: manifest?.selectors.images,
      note: 'This is a capability supplement job. Keep the same adapter identity and only add metadata/chapter-list selectors unless image selectors are explicitly revalidated.',
    };
  }

  private mergeManifestWithBase(
    supplement: DynamicSiteAdapterManifest,
    manifests: DynamicSiteAdapterManifest[],
    baseAdapterId: string
  ): DynamicSiteAdapterManifest {
    const base = manifests.find((item) => item.adapterId === baseAdapterId);
    if (!base) {
      throw new Error(`Base dynamic adapter manifest "${baseAdapterId}" was not found.`);
    }
    return {
      ...base,
      name: supplement.name || base.name,
      domains: Array.from(new Set([...base.domains, ...supplement.domains])),
      urlPatterns: Array.from(new Set([...base.urlPatterns, ...supplement.urlPatterns])),
      capabilities: {
        verification: base.capabilities?.verification ?? supplement.capabilities?.verification ?? true,
        metadata: true,
        chapterImages: true,
      },
      selectors: {
        metadata: supplement.selectors.metadata ?? base.selectors.metadata,
        chapters: supplement.selectors.chapters ?? base.selectors.chapters,
        images: hasCompleteImageSelectors(supplement.selectors.images) ? supplement.selectors.images : base.selectors.images,
      },
      sourceDiscoveryId: supplement.sourceDiscoveryId,
      promotedAt: supplement.promotedAt,
    };
  }

  private async compareWithBuiltInOracle(job: SelectorDiscoveryJob): Promise<SelectorDiscoveryOracleComparison | undefined> {
    const oracle = this.adapterRegistry.findByUrl(job.normalizedUrl);
    if (!oracle) return undefined;

    const warnings: string[] = [];
    let oracleTitle: string | undefined;
    let oracleChapterCount = 0;
    let oracleFirstChapterUrl: string | undefined;
    let oracleImageCount: number | undefined;
    let oracleFirstImageUrl: string | undefined;

    try {
      if (!(oracle instanceof AdapterBase)) return undefined;
      const metadata = await composeMetadata(oracle, job.normalizedUrl);
      oracleTitle = metadata.title;
      oracleChapterCount = metadata.chapters.length;
      oracleFirstChapterUrl = metadata.chapters[0]?.url;
      if (oracleFirstChapterUrl) {
        const images = await composeChapterImages(oracle, oracleFirstChapterUrl);
        oracleImageCount = images.length;
        oracleFirstImageUrl = images[0]?.url;
      } else {
        warnings.push('Oracle adapter did not return a representative chapter URL.');
      }
    } catch (error) {
      warnings.push(`Oracle extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const candidate = job.extractionValidation;
    const candidateTitle = candidate?.metadata?.title;
    const candidateChapterCount = candidate?.metadata?.chapterCount ?? 0;
    const candidateImageCount = candidate?.images?.imageCount;
    const imageCountDelta = typeof oracleImageCount === 'number' && typeof candidateImageCount === 'number'
      ? candidateImageCount - oracleImageCount
      : undefined;

    if (!candidate?.valid) warnings.push('Candidate extraction validation has not passed.');
    if (normalizeComparableText(candidateTitle) !== normalizeComparableText(oracleTitle)) warnings.push('Candidate title differs from oracle title.');
    if (Math.abs(candidateChapterCount - oracleChapterCount) > 0) warnings.push('Candidate chapter count differs from oracle chapter count.');
    if (typeof imageCountDelta === 'number' && imageCountDelta !== 0) warnings.push('Candidate image count differs from oracle image count.');

    return {
      adapterId: oracle.id,
      adapterName: oracle.name,
      checkedAt: new Date().toISOString(),
      candidate: {
        title: candidateTitle,
        chapterCount: candidateChapterCount,
        firstChapterUrl: candidate?.metadata?.firstChapterUrl,
        imageCount: candidateImageCount,
        firstImageUrl: candidate?.images?.firstImageUrl,
      },
      oracle: {
        title: oracleTitle,
        chapterCount: oracleChapterCount,
        firstChapterUrl: oracleFirstChapterUrl,
        imageCount: oracleImageCount,
        firstImageUrl: oracleFirstImageUrl,
      },
      titleMatched: normalizeComparableText(candidateTitle) === normalizeComparableText(oracleTitle),
      chapterCountDelta: candidateChapterCount - oracleChapterCount,
      imageCountDelta,
      warnings,
    };
  }
}
