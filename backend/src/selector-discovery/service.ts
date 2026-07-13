import type { AdapterRegistry } from '../adapter/registry';
import { getAdapterCapabilities } from '../adapter/registry';
import { AdapterBase } from '../adapter/base';
import { composeChapterImages, composeMetadata } from '../adapter/runtime-composer';
import { DynamicSiteAdapter, type DynamicSiteAdapterManifest } from '../adapter/dynamic-site-adapter';
import type { BrowserConfig, NetworkConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import { AoClient } from './ao-client';
import { SelectorDiscoveryBundleManager } from './bundle-manager';
import { parseMarkdownCandidate, validateMarkdownCandidate } from './markdown-candidate';
import { validateChapterImageSelectorExtraction, validateSelectorExtraction } from './extraction-validator';
import { fetchSafeHtml, normalizeAndValidateUrl, type SafeHtmlFetchResult } from './safe-fetch';
import { looksLikeAntiBotChallenge } from '../crawler/anti-bot';
import { SelectorDiscoverySettingsStore } from './settings-store';
import { validateAdapterImplementationDraft, validateCapabilityDraft } from './adapter-implementation';
import { createChapterOnlyTaskMarkdown, createManifestMarkdown, createPhase1TaskMarkdown, createPhase2TaskMarkdown, extractFallbackChapterUrlFromHtml, extractRepresentativeChapterUrl, validatePhase1Markdown } from './task-markdown';
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
const ACTIVE_DYNAMIC_ADAPTERS_KEY = 'selector-discovery-active-adapters';
const SHADOW_PROMOTION_PREFIX = 'selector-discovery-shadow-promotion-';
const CAPABILITY_DRAFT_OUTPUTS: Array<Omit<SelectorDiscoveryCapabilityDraft, 'sourceTs' | 'reviewMarkdown' | 'validation'>> = [
  { stage: 'common-verification', sourcePath: 'outputs/common-verification.ts', reviewPath: 'outputs/common-verification-review.md' },
  { stage: 'metadata', sourcePath: 'outputs/metadata-capability.ts', reviewPath: 'outputs/metadata-review.md' },
  { stage: 'chapter-images', sourcePath: 'outputs/chapter-images-capability.ts', reviewPath: 'outputs/chapter-images-review.md' },
];

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
  }

  async promote(id: string): Promise<DynamicSiteAdapterManifest> {
    const job = await this.getRequiredJob(id);
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
      await this.updateJob(id, { adapterId: baseAdapterId, adapterName: merged.name });
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
    await this.updateJob(id, { adapterId, adapterName: manifest.name });
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
      const phase1 = await this.runAoPhase(client, bundle, model, createPhase1TaskMarkdown({
        url: job.normalizedUrl,
        metadataFetch,
        existingAdapter: existingAdapterContext,
      }), 'outputs/phase1-output.md');
      const phase1Validation = validatePhase1Markdown(phase1);
      if (!phase1Validation.valid) {
        await this.updateJob(job.id, {
          status: 'invalid',
          phase: 'complete',
          phase1Markdown: phase1,
          model,
          aoBaseUrl,
          error: phase1Validation.errors.join('; '),
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
    outputPath: string
  ): Promise<string> {
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

Use the exact Markdown headings required by the referenced contract file. Do not rename, decorate, or add parenthetical suffixes to required headings. If this is the final candidate, the first required section must be exactly "## Adapter Identity".`,
        model,
        DEFAULT_SELECTOR_DISCOVERY_AGENT
      );
      const output = await client.readFile(conversationId, outputPath).catch(() => '');
      return output.trim() || response.text?.trim() || '';
    } finally {
      await client.deleteConversation(conversationId).catch(() => undefined);
    }
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

function hasCompleteImageSelectors(selectors: DynamicSiteAdapterManifest['selectors']['images'] | undefined): boolean {
  return Boolean(selectors?.item && selectors.srcAttr);
}

function tryExtractRepresentativeChapterUrl(markdown: string, baseUrl: string): string | undefined {
  try {
    return extractRepresentativeChapterUrl(markdown, baseUrl);
  } catch {
    return undefined;
  }
}

function safeAdapterId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dynamic-site';
}

function formatCapabilityDraftsForCompose(drafts: SelectorDiscoveryCapabilityDraft[]): string {
  if (drafts.length === 0) {
    return '# Capability Drafts\n\nNo capability drafts were produced.';
  }
  return `# Capability Drafts

${drafts.map((draft) => `## ${draft.stage}

### Validation

- valid: ${draft.validation?.valid ?? false}
- errors: ${draft.validation?.errors.join('; ') || 'none'}
- warnings: ${draft.validation?.warnings.join('; ') || 'none'}

### Source

\`\`\`ts
${draft.sourceTs ?? ''}
\`\`\`

### Review Notes

${draft.reviewMarkdown || 'none'}
`).join('\n')}`;
}

function formatCapabilityDraftFailureReview(drafts: SelectorDiscoveryCapabilityDraft[]): string {
  const failed = drafts.filter((draft) => draft.validation && !draft.validation.valid);
  return `# Capability Draft Validation Failed

ComicCrawler stopped before compose because at least one capability draft was
invalid. Fix the AO-facing documents or retry after updating the prompt.

${failed.map((draft) => `## ${draft.stage}

- source path: ${draft.sourcePath}
- review path: ${draft.reviewPath}
- errors:
${(draft.validation?.errors ?? []).map((error) => `  - ${error}`).join('\n') || '  - unknown'}
`).join('\n')}`;
}

function formatCapabilityStageSmokeReview(drafts: SelectorDiscoveryCapabilityDraft[]): string {
  const latest = drafts.at(-1);
  return `# Capability Stage Smoke Complete

ComicCrawler stopped after ${latest?.stage ?? 'unknown'} as requested.

${drafts.map((draft) => `## ${draft.stage}

- source path: ${draft.sourcePath}
- review path: ${draft.reviewPath}
- validation: ${draft.validation?.valid ? 'valid' : 'invalid'}
- errors: ${draft.validation?.errors.join('; ') || 'none'}
`).join('\n')}`;
}

function adapterSupportsDiscoveryTarget(
  adapter: { capabilities?: { verification?: boolean; metadata: boolean; chapterImages: boolean } },
  target: 'full' | 'chapter-only'
): boolean {
  const capabilities = getAdapterCapabilities(adapter as any);
  if (target === 'chapter-only') return capabilities.chapterImages;
  return capabilities.metadata && capabilities.chapterImages;
}

function shouldRetryCapabilityDraft(draft: SelectorDiscoveryCapabilityDraft): boolean {
  const errors = draft.validation?.errors ?? [];
  return errors.some((error) => (
    error.includes('template selectors') ||
    error.includes('not present in task DOM evidence') ||
    error.includes('not present in task URL evidence') ||
    error.includes('require() is not allowed') ||
    error.includes('Adapter identity must be readonly class fields') ||
    error.includes('must not declare adapter identity') ||
    error.includes('Capability extraction methods must not keep template placeholders') ||
    error.includes('Template placeholder values') ||
    error.includes('ComicStatus is a string union') ||
    error.includes('ChapterInfo entries must not use ComicStatus') ||
    error.includes('must populate ChapterInfo.id') ||
    error.includes('must populate ChapterInfo.url') ||
    error.includes('ChapterInfo uses url') ||
    error.includes('must not use new Date()') ||
    error.includes('must be absolute') ||
    error.includes('must be derived from the chapter URL path segment') ||
    error.includes('must not implement metadata or chapter image extraction methods') ||
    error.includes('Do not redeclare ComicCrawler framework classes') ||
    error.includes('must not export an AdapterBase shell') ||
    error.includes('must not implement common or verification capabilities')
  ));
}

function createCapabilityRetryFeedback(draft: SelectorDiscoveryCapabilityDraft, attempt: number): string {
  const errors = draft.validation?.errors ?? [];
  const sourceMissing = !draft.sourceTs?.trim();
  const lines = [
    `Attempt ${attempt} failed.`,
    sourceMissing
      ? `The requested TypeScript file was empty or missing: ${draft.sourcePath}.`
      : 'The requested TypeScript file failed validation.',
    '',
    'Required correction:',
    `- Write TypeScript source directly to ${draft.sourcePath}.`,
    `- Write review notes directly to ${draft.reviewPath}.`,
    '- Do not put TypeScript only in chat.',
    '- Do not write JSON.',
    '- Do not write outputs/adapter-implementation.ts.',
  ];
  if (errors.length > 0) {
    lines.push('', 'Validation errors to fix:', ...errors.map((error) => `- ${error}`));
  }
  if (draft.stage === 'metadata') {
    lines.push(
      '',
      'Metadata stage reminders:',
      '- Output exactly one MetadataCapability subclass.',
      '- Do not throw for missing optional selectors; return undefined or [].',
      '- ComicStatus is a string union: return "ongoing", "completed", or "unknown".',
      '- ChapterInfo entries require id, title, and absolute url.',
      '- Do not set ChapterInfo.status, sourceUrl, totalImages, or completedImages.'
    );
  }
  return lines.join('\n');
}

function extractFirstTypeScriptFence(text: string): string {
  const match = /```(?:typescript|ts)\s*([\s\S]*?)```/i.exec(text);
  return match?.[1]?.trim() ?? '';
}

function composeAdapterShellFromCapabilities(
  job: SelectorDiscoveryJob,
  drafts: SelectorDiscoveryCapabilityDraft[]
): { reviewNotesMarkdown: string; adapterImplementationTs: string } {
  const sources = drafts.map((draft) => draft.sourceTs?.trim() ?? '').filter(Boolean);
  const commonSource = drafts.find((draft) => draft.stage === 'common-verification')?.sourceTs ?? '';
  const commonClass = extractCapabilityClassName(commonSource, 'CommonCapability');
  const verificationClass = extractCapabilityClassName(commonSource, 'VerificationCapability');
  const metadataClass = extractCapabilityClassName(drafts.find((draft) => draft.stage === 'metadata')?.sourceTs ?? '', 'MetadataCapability');
  const chapterImagesClass = extractCapabilityClassName(drafts.find((draft) => draft.stage === 'chapter-images')?.sourceTs ?? '', 'ChapterImagesCapability');
  const classPrefix = toPascalIdentifier(job.hostname.replace(/^m\./i, ''));
  const adapterId = createAdapterId(job.hostname);
  const capabilities = {
    verification: true,
    metadata: job.target !== 'chapter-only',
    chapterImages: true,
  };
  const shell = `export class ${classPrefix}Adapter extends AdapterBase {
  readonly id = '${adapterId}';
  readonly name = '${toDisplayName(job.hostname)}';
  readonly domains = ['${job.hostname}'];
  readonly parseMode = 'static' as const;
  readonly capabilities = {
    verification: ${capabilities.verification},
    metadata: ${capabilities.metadata},
    chapterImages: ${capabilities.chapterImages},
  };

  readonly common = new ${commonClass}(this);
  readonly verification = new ${verificationClass}(this);
${capabilities.metadata ? `  readonly metadata = new ${metadataClass}(this);\n` : ''}  readonly chapterImages = new ${chapterImagesClass}(this);
}`;
  const body = sources.map(stripTypeScriptImports).join('\n\n');
  return {
    adapterImplementationTs: `import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import {
  AdapterBase,
  CommonCapability,
  VerificationCapability,
  MetadataCapability,
  ChapterImagesCapability,
} from '../../base';

${shell}

${body}
`,
    reviewNotesMarkdown: `# System-Composed Adapter Draft

ComicCrawler assembled the AdapterBase shell from reviewed capability drafts.
AO/Agent produced only capability subclasses.

## Adapter Identity

- id: ${adapterId}
- name: ${toDisplayName(job.hostname)}
- domains: ${job.hostname}
- parseMode: static

## Capability Classes

- CommonCapability: ${commonClass}
- VerificationCapability: ${verificationClass}
- MetadataCapability: ${capabilities.metadata ? metadataClass : 'not implemented for chapter-only target'}
- ChapterImagesCapability: ${chapterImagesClass}
`,
  };
}

function extractCapabilityClassName(source: string, baseClass: string): string {
  const match = new RegExp(`\\bclass\\s+(\\w+)\\s+extends\\s+${baseClass}\\b`).exec(source);
  if (!match?.[1]) {
    return `Missing${baseClass}`;
  }
  return match[1];
}

function stripTypeScriptImports(source: string): string {
  return source
    .replace(/^import\s+type\s+[^;]+;\s*/gm, '')
    .replace(/^import\s+\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^import\s+[^;]+;\s*/gm, '')
    .trim();
}

function createAdapterId(hostname: string): string {
  return hostname.replace(/^www\./i, '').replace(/^m\./i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'site';
}

function validateMetadataSelectorEvidence(source: string, taskMarkdown: string): string[] {
  const errors: string[] = [];
  const selectors = extractCheerioSelectors(source);
  const normalizedTask = taskMarkdown.toLowerCase();
  const reported = new Set<string>();
  for (const selector of selectors) {
    if (selector.startsWith('meta[') || selector === 'title' || selector === 'body') continue;
    for (const className of extractCssClassNames(selector)) {
      const evidenceNeedles = [
        `.${className.toLowerCase()}`,
        `class=${className.toLowerCase()}`,
        `class="${className.toLowerCase()}`,
      ];
      if (!evidenceNeedles.some((needle) => normalizedTask.includes(needle))) {
        const key = `class:${className}`;
        if (!reported.has(key)) {
          errors.push(`Metadata selector ".${className}" is not present in task DOM evidence.`);
          reported.add(key);
        }
      }
    }
    for (const pathNeedle of extractHrefPathNeedles(selector)) {
      if (!normalizedTask.includes(pathNeedle.toLowerCase())) {
        const key = `href:${pathNeedle}`;
        if (!reported.has(key)) {
          errors.push(`Metadata selector href path "${pathNeedle}" is not present in task URL evidence.`);
          reported.add(key);
        }
      }
    }
  }
  return errors;
}

function extractCheerioSelectors(source: string): string[] {
  const selectors: string[] = [];
  const pattern = /\$\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const selector = match[2]?.trim();
    if (!selector || selector.includes('<')) continue;
    selectors.push(selector);
  }
  return selectors;
}

function extractCssClassNames(selector: string): string[] {
  const classes: string[] = [];
  const pattern = /\.([_a-zA-Z][-_a-zA-Z0-9]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(selector)) !== null) {
    const className = match[1];
    if (className && className !== 'first' && className !== 'last') {
      classes.push(className);
    }
  }
  return classes;
}

function extractHrefPathNeedles(selector: string): string[] {
  const needles: string[] = [];
  const pattern = /href[*^$|~]?=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(selector)) !== null) {
    const value = match[1]?.trim();
    if (value?.startsWith('/')) needles.push(value);
  }
  return needles;
}

function normalizeComparableText(value?: string): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function createCommonVerificationSkeleton(sourceUrl: string, hostname: string): string {
  const classPrefix = toPascalIdentifier(hostname.replace(/^m\./i, ''));
  const urlPath = safeUrlPathPrefix(sourceUrl);
  const baseHostname = hostname.replace(/^m\./i, '');
  const pathCheck = urlPath
    ? `parsed.pathname === '${urlPath}' || parsed.pathname.startsWith('${urlPath}/')`
    : `parsed.pathname.startsWith('/')`;
  return `import {
  CommonCapability,
  VerificationCapability,
} from '../../base';

class ${classPrefix}CommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (parsed.hostname === '${hostname}' || parsed.hostname === '${baseHostname}') &&
        (${pathCheck});
    } catch {
      return false;
    }
  }
}

class ${classPrefix}VerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /human verification|captcha|blocked|challenge|cloudflare|人机验证|人機驗證|HTTP\\s+(?:403|429|503)\\b/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return {
      supported: true,
      flow: 'Task enters waiting_verification and the user completes verification through the task detail handoff.',
    };
  }
}
`;
}

function createMetadataSkeleton(hostname: string): string {
  const classPrefix = toPascalIdentifier(hostname.replace(/^m\./i, ''));
  return `import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability } from '../../base';

class ${classPrefix}MetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific title extraction from task.md evidence.');
  }

  extractAuthor(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific author extraction from task.md evidence.');
  }

  extractDescription(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific description extraction from task.md evidence.');
  }

  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific cover URL extraction from task.md evidence.');
  }

  extractTags(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific tag extraction from task.md evidence.');
  }

  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific status extraction from task.md evidence.');
  }

  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific chapter list extraction from task.md evidence.');
  }
}
`;
}

function toPascalIdentifier(value: string): string {
  const parts = value.split(/[^a-z0-9]+/i).filter(Boolean);
  const name = parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('');
  return /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : 'Site';
}

function toDisplayName(hostname: string): string {
  return hostname.replace(/^m\./i, '').split('.').filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}

function safeUrlPathPrefix(sourceUrl: string): string {
  try {
    const path = new URL(sourceUrl).pathname;
    const firstSegment = path.split('/').filter(Boolean)[0];
    return firstSegment ? `/${firstSegment}` : '';
  } catch {
    return '';
  }
}

function createChapterOnlyPhase1Markdown(finalUrl: string): string {
  return `# Phase 1 Result

## Site Decision

- Snapshot source: fetched chapter reader HTML.
- Discovery target: chapter-only adapter.

## Title Extraction

- Not required for chapter-only discovery.

## Chapter List Extraction

- Not required for chapter-only discovery.

## Representative Chapter URL

${finalUrl}

## Evidence

- The supplied URL is treated as the representative chapter page.
- Chapter-only discovery intentionally extracts image selectors only.

## Uncertainty

- Metadata and chapter list extraction are intentionally out of scope for chapter-only discovery.
`;
}
