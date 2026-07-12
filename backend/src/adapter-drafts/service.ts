import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AdapterDraftDetailResponse,
  AdapterDraftSourceKind,
  AdapterDraftStatus,
  AdapterDraftSummary,
} from '@comiccrawler/shared';
import type { AdapterRegistry } from '../adapter/registry';
import { DynamicSiteAdapter } from '../adapter/dynamic-site-adapter';

const BUILTIN_ADAPTER_SOURCE: Record<string, string> = {
  kuronavi: join('backend', 'src', 'adapter', 'sites', 'kuronavi', 'adapter.ts'),
  happymh: join('backend', 'src', 'adapter', 'sites', 'happymh', 'adapter.ts'),
};

interface AdapterDraftMeta {
  draftId: string;
  baseAdapterId: string;
  baseAdapterName: string;
  sourceKind: AdapterDraftSourceKind;
  language: 'typescript' | 'json';
  status: AdapterDraftStatus;
  createdAt: string;
  updatedAt: string;
  contentFile: string;
}

export class AdapterDraftService {
  private readonly draftsRoot: string;

  constructor(
    userPath: string,
    private readonly adapterRegistry: AdapterRegistry
  ) {
    this.draftsRoot = join(userPath, 'adapter-drafts');
  }

  async list(): Promise<AdapterDraftSummary[]> {
    await mkdir(this.draftsRoot, { recursive: true });
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(this.draftsRoot, { withFileTypes: true }).catch(() => []);
    const drafts: AdapterDraftSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await this.readMeta(entry.name).catch(() => undefined);
      if (meta && meta.status !== 'discarded') drafts.push(toSummary(meta));
    }
    return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async create(baseAdapterId: string): Promise<AdapterDraftDetailResponse> {
    const adapter = this.adapterRegistry.get(baseAdapterId);
    if (!adapter) throw new Error(`Adapter "${baseAdapterId}" was not found.`);

    const now = new Date().toISOString();
    const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const initial = await this.loadInitialContent(baseAdapterId);
    const contentFile = initial.language === 'json' ? 'manifest.json' : 'implementation.ts';
    const meta: AdapterDraftMeta = {
      draftId,
      baseAdapterId,
      baseAdapterName: adapter.name,
      sourceKind: initial.sourceKind,
      language: initial.language,
      status: 'editing',
      createdAt: now,
      updatedAt: now,
      contentFile,
    };

    const dir = this.draftDir(draftId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, contentFile), initial.content, 'utf-8');
    await this.writeMeta(meta);
    return this.toDetail(meta, initial.content);
  }

  async get(draftId: string): Promise<AdapterDraftDetailResponse | undefined> {
    const meta = await this.readMeta(draftId).catch(() => undefined);
    if (!meta || meta.status === 'discarded') return undefined;
    const content = await readFile(join(this.draftDir(draftId), meta.contentFile), 'utf-8');
    return this.toDetail(meta, content);
  }

  async save(draftId: string, content: string): Promise<AdapterDraftDetailResponse> {
    const meta = await this.requireMeta(draftId);
    const now = new Date().toISOString();
    const nextMeta: AdapterDraftMeta = { ...meta, updatedAt: now, status: 'editing' };
    await writeFile(join(this.draftDir(draftId), meta.contentFile), content, 'utf-8');
    await this.writeMeta(nextMeta);
    return this.toDetail(nextMeta, content);
  }

  async reset(draftId: string): Promise<AdapterDraftDetailResponse> {
    const meta = await this.requireMeta(draftId);
    const initial = await this.loadInitialContent(meta.baseAdapterId);
    if (initial.language !== meta.language) {
      throw new Error(`Base adapter source kind changed from ${meta.language} to ${initial.language}. Create a new draft instead.`);
    }
    const now = new Date().toISOString();
    const nextMeta: AdapterDraftMeta = { ...meta, updatedAt: now, status: 'editing' };
    await writeFile(join(this.draftDir(draftId), meta.contentFile), initial.content, 'utf-8');
    await this.writeMeta(nextMeta);
    return this.toDetail(nextMeta, initial.content);
  }

  async discard(draftId: string): Promise<void> {
    await rm(this.draftDir(draftId), { recursive: true, force: true });
  }

  private async requireMeta(draftId: string): Promise<AdapterDraftMeta> {
    const meta = await this.readMeta(draftId).catch(() => undefined);
    if (!meta || meta.status === 'discarded') throw new Error(`Adapter draft "${draftId}" was not found.`);
    return meta;
  }

  private async loadInitialContent(adapterId: string): Promise<{ sourceKind: AdapterDraftSourceKind; language: 'typescript' | 'json'; content: string }> {
    const adapter = this.adapterRegistry.get(adapterId);
    if (!adapter) throw new Error(`Adapter "${adapterId}" was not found.`);
    if (adapter instanceof DynamicSiteAdapter) {
      return {
        sourceKind: 'dynamic-manifest',
        language: 'json',
        content: JSON.stringify(adapter.getManifest(), null, 2),
      };
    }

    const relativePath = BUILTIN_ADAPTER_SOURCE[adapter.id];
    if (!relativePath) throw new Error(`Built-in source is not allowlisted for adapter "${adapter.id}".`);
    const sourcePath = resolveAllowlistedSourcePath(relativePath);
    if (!existsSync(sourcePath)) throw new Error(`Allowlisted source file was not found: ${relativePath}`);
    return {
      sourceKind: 'built-in-source',
      language: 'typescript',
      content: await readFile(sourcePath, 'utf-8'),
    };
  }

  private draftDir(draftId: string): string {
    return join(this.draftsRoot, sanitizePathSegment(draftId));
  }

  private async readMeta(draftId: string): Promise<AdapterDraftMeta> {
    return JSON.parse(await readFile(join(this.draftDir(draftId), 'meta.json'), 'utf-8')) as AdapterDraftMeta;
  }

  private async writeMeta(meta: AdapterDraftMeta): Promise<void> {
    const dir = this.draftDir(meta.draftId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  }

  private toDetail(meta: AdapterDraftMeta, content: string): AdapterDraftDetailResponse {
    return {
      draft: toSummary(meta),
      language: meta.language,
      content,
    };
  }
}

function toSummary(meta: AdapterDraftMeta): AdapterDraftSummary {
  return {
    draftId: meta.draftId,
    baseAdapterId: meta.baseAdapterId,
    baseAdapterName: meta.baseAdapterName,
    sourceKind: meta.sourceKind,
    language: meta.language,
    status: meta.status,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

function resolveAllowlistedSourcePath(relativePath: string): string {
  const candidates = [
    join(process.cwd(), relativePath),
    join(process.cwd(), '..', relativePath),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
