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
import { validateAdapterImplementationDraft } from './adapter-implementation';
import { createChapterOnlyTaskMarkdown, createManifestMarkdown, createPhase1TaskMarkdown, createPhase2TaskMarkdown, extractFallbackChapterUrlFromHtml, extractRepresentativeChapterUrl } from './task-markdown';
import {
  DEFAULT_SELECTOR_DISCOVERY_AGENT,
  DEFAULT_SELECTOR_DISCOVERY_MODEL,
  type DiscoveryInput,
  type SelectorDiscoveryOracleComparison,
  type SelectorDiscoveryJob,
  type SelectorDiscoveryShadowPromotion,
} from './types';

const JOB_PREFIX = 'selector-discovery-job-';
const INDEX_KEY = 'selector-discovery-index';
const ACTIVE_DYNAMIC_ADAPTERS_KEY = 'selector-discovery-active-adapters';
const SHADOW_PROMOTION_PREFIX = 'selector-discovery-shadow-promotion-';
const ADAPTER_IMPLEMENTATION_OUTPUT_PATH = 'outputs/adapter-implementation.ts';
const REVIEW_NOTES_OUTPUT_PATH = 'outputs/review-notes.md';

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

      await this.updateJob(job.id, { phase1Markdown: phase1, phase: 'phase2', model, aoBaseUrl });
      const chapterUrl = tryExtractRepresentativeChapterUrl(phase1, metadataFetch.finalUrl)
        ?? extractFallbackChapterUrlFromHtml(metadataFetch.html, metadataFetch.finalUrl);
      if (!chapterUrl) {
        throw new Error('Phase 1 output did not include a Representative Chapter URL and no fallback chapter link was found.');
      }
      const chapterFetch = await fetchSafeHtml(chapterUrl, safeFetchOptions);
      const implementation = await this.runAoImplementationPhase(client, bundle, model, createPhase2TaskMarkdown({
        url: job.normalizedUrl,
        phase1Markdown: phase1,
        chapterFetch,
        existingAdapter: existingAdapterContext,
      }));

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
    client: AoClient,
    bundle: Awaited<ReturnType<SelectorDiscoveryBundleManager['loadActive']>>,
    model: string,
    taskMarkdown: string
  ): Promise<{ reviewNotesMarkdown: string; adapterImplementationTs: string }> {
    const conversationId = await client.createConversation();
    try {
      await this.bundleManager.upload(client, conversationId, bundle);
      await client.uploadFile(conversationId, 'task.md', taskMarkdown);
      await client.start(conversationId);
      const response = await client.message(
        conversationId,
        `${taskMarkdown}

## Required AO Output

Write the TypeScript adapter implementation to ${ADAPTER_IMPLEMENTATION_OUTPUT_PATH}.
Write human review notes to ${REVIEW_NOTES_OUTPUT_PATH}.

Also return the review notes in your chat response. Do not output JSON.

The TypeScript source must export one class that extends AdapterBase and implements the declared capabilities with fine-grained extraction functions. Do not implement fetchMetadata() or fetchChapterImages().`,
        model,
        DEFAULT_SELECTOR_DISCOVERY_AGENT
      );
      const [adapterImplementationTs, reviewNotesMarkdown] = await Promise.all([
        client.readFile(conversationId, ADAPTER_IMPLEMENTATION_OUTPUT_PATH).catch(() => ''),
        client.readFile(conversationId, REVIEW_NOTES_OUTPUT_PATH).catch(() => ''),
      ]);
      return {
        adapterImplementationTs: adapterImplementationTs.trim(),
        reviewNotesMarkdown: reviewNotesMarkdown.trim() || response.text?.trim() || '',
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
    output: { reviewNotesMarkdown: string; adapterImplementationTs: string }
  ): Promise<void> {
    const implementationValidation = validateAdapterImplementationDraft(output.adapterImplementationTs, {
      target: job.target,
    });
    await this.updateJob(job.id, {
      status: implementationValidation.valid ? 'awaiting_review' : 'invalid',
      phase: 'complete',
      reviewNotesMarkdown: output.reviewNotesMarkdown,
      adapterImplementationTs: output.adapterImplementationTs,
      implementationValidation,
      error: implementationValidation.valid ? undefined : implementationValidation.errors.join('; '),
    });
    await this.storage.write(`selector-discovery-implementation-${job.id}`, {
      reviewNotesMarkdown: output.reviewNotesMarkdown,
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

function adapterSupportsDiscoveryTarget(
  adapter: { capabilities?: { verification?: boolean; metadata: boolean; chapterImages: boolean } },
  target: 'full' | 'chapter-only'
): boolean {
  const capabilities = getAdapterCapabilities(adapter as any);
  if (target === 'chapter-only') return capabilities.chapterImages;
  return capabilities.metadata && capabilities.chapterImages;
}

function normalizeComparableText(value?: string): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
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
