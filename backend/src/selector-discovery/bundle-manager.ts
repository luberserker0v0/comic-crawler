import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, relative } from 'node:path';
import type { AoClient } from './ao-client';
import type { ProviderDocument } from './types';
import { createStoredZip } from './zip';
import { mergeProviderIntoOpenCodeConfig } from './provider-config';

export interface SelectorDiscoveryBundle {
  root: string;
  hash: string;
  opencode: Record<string, unknown>;
  agentConfig: string;
  agents: Array<{ name: string; content: string }>;
  skills: Array<{ name: string; zip: Buffer }>;
  contracts: Array<{ path: string; content: string }>;
}

export interface SelectorDiscoveryFreezeResult {
  release: string;
  sourceRoot: string;
  releaseRoot: string;
  sha256: string;
  activePath: string;
  evalBundleHash?: string;
}

export interface SelectorDiscoveryBundleStatus {
  mode: 'draft' | 'release';
  bundleRoot: string;
  activePath: string;
  activeRelease?: SelectorDiscoveryActiveRelease;
  activeRoot: string;
  release?: string;
  expectedSha256?: string;
  actualSha256?: string;
  verified: boolean;
  error?: string;
}

export interface SelectorDiscoveryActiveRelease {
  release?: string | null;
  sha256?: string;
  frozenAt?: string;
  source?: string;
  evalBundleHash?: string;
  note?: string;
}

export class SelectorDiscoveryBundleManager {
  constructor(private readonly bundleRoot = process.env.AO_BUNDLE_PATH || join(process.cwd(), 'agent/ao/selector-discovery')) {}

  async loadActive(providerDocument: ProviderDocument, model: string): Promise<SelectorDiscoveryBundle> {
    const releaseRoot = await this.resolveActiveReleaseRoot();
    const baseConfig = JSON.parse(await fs.readFile(join(releaseRoot, 'opencode.json'), 'utf-8')) as Record<string, unknown>;
    const renderedConfig = injectModelIntoConfig(mergeProviderIntoOpenCodeConfig(baseConfig, providerDocument), model);
    const hashConfig = injectModelIntoConfig(stripProvider(baseConfig), model);
    const agentConfig = await fs.readFile(join(releaseRoot, 'AGENTS.md'), 'utf-8');
    const agents = await this.readNamedMarkdownFiles(join(releaseRoot, 'agents'), model);
    const skills = await this.readSkills(join(releaseRoot, 'skills'));
    const contracts = await this.readContracts(join(releaseRoot, 'contracts'));
    const hash = createHash('sha256')
      .update(JSON.stringify(hashConfig))
      .update(agentConfig)
      .update(agents.map((agent) => `${agent.name}\n${agent.content}`).join('\n'))
      .update(skills.map((skill) => `${skill.name}\n${createHash('sha256').update(skill.zip).digest('hex')}`).join('\n'))
      .update(contracts.map((contract) => `${contract.path}\n${contract.content}`).join('\n'))
      .digest('hex');

    return { root: releaseRoot, hash, opencode: renderedConfig, agentConfig, agents, skills, contracts };
  }

  async upload(client: AoClient, conversationId: string, bundle: SelectorDiscoveryBundle): Promise<void> {
    await client.uploadConfig(conversationId, bundle.opencode);
    await client.uploadAgentConfig(conversationId, bundle.agentConfig);
    for (const agent of bundle.agents) {
      await client.uploadAgent(conversationId, agent.name, agent.content);
    }
    for (const skill of bundle.skills) {
      await client.uploadSkill(conversationId, skill.name, skill.zip);
    }
    for (const contract of bundle.contracts) {
      await client.uploadFile(conversationId, contract.path, contract.content);
    }
  }

  async getStatus(): Promise<SelectorDiscoveryBundleStatus> {
    const root = await this.resolveBundleRoot();
    const activePath = join(root, 'active.json');
    let active: SelectorDiscoveryActiveRelease | undefined;
    try {
      active = JSON.parse(await fs.readFile(activePath, 'utf-8')) as SelectorDiscoveryActiveRelease;
    } catch {
      const activeRoot = join(root, 'draft');
      return {
        mode: 'draft',
        bundleRoot: root,
        activePath,
        activeRoot,
        actualSha256: await hashDirectory(activeRoot).catch(() => undefined),
        verified: false,
        error: 'active.json is missing or unreadable; using draft bundle.',
      };
    }

    if (!active.release) {
      const activeRoot = join(root, 'draft');
      return {
        mode: 'draft',
        bundleRoot: root,
        activePath,
        activeRelease: active,
        activeRoot,
        actualSha256: await hashDirectory(activeRoot).catch(() => undefined),
        verified: false,
      };
    }

    const activeRoot = join(root, 'releases', active.release);
    if (!active.sha256) {
      return {
        mode: 'release',
        bundleRoot: root,
        activePath,
        activeRelease: active,
        activeRoot,
        release: active.release,
        verified: false,
        error: `Active selector-discovery release "${active.release}" is missing sha256.`,
      };
    }

    try {
      const actualSha256 = await hashDirectory(activeRoot);
      return {
        mode: 'release',
        bundleRoot: root,
        activePath,
        activeRelease: active,
        activeRoot,
        release: active.release,
        expectedSha256: active.sha256,
        actualSha256,
        verified: actualSha256 === active.sha256,
        error: actualSha256 === active.sha256
          ? undefined
          : `Active selector-discovery release "${active.release}" SHA-256 mismatch.`,
      };
    } catch (error) {
      return {
        mode: 'release',
        bundleRoot: root,
        activePath,
        activeRelease: active,
        activeRoot,
        release: active.release,
        expectedSha256: active.sha256,
        verified: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async freezeDraft(input: { version?: string; evalBundleHash?: string } = {}): Promise<SelectorDiscoveryFreezeResult> {
    const root = await this.resolveBundleRoot();
    const sourceRoot = join(root, 'draft');
    const releasesRoot = join(root, 'releases');
    await fs.mkdir(releasesRoot, { recursive: true });
    const release = input.version ?? await this.nextReleaseName(releasesRoot);
    if (!/^v[0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(release)) {
      throw new Error('Release version must look like "v1", "v2", or "v1-rc1".');
    }

    const releaseRoot = join(releasesRoot, release);
    try {
      await fs.access(releaseRoot);
      throw new Error(`Release "${release}" already exists.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) throw error;
    }

    await fs.cp(sourceRoot, releaseRoot, { recursive: true, errorOnExist: true, force: false });
    const sha256 = await hashDirectory(releaseRoot);
    const activePath = join(root, 'active.json');
    await fs.writeFile(activePath, `${JSON.stringify({
      release,
      sha256,
      frozenAt: new Date().toISOString(),
      source: 'draft',
      evalBundleHash: input.evalBundleHash,
      note: 'Frozen selector-discovery AO bundle. Runtime should load this active release.',
    }, null, 2)}\n`, 'utf-8');

    return {
      release,
      sourceRoot,
      releaseRoot,
      sha256,
      activePath,
      evalBundleHash: input.evalBundleHash,
    };
  }

  private async resolveActiveReleaseRoot(): Promise<string> {
    const root = await this.resolveBundleRoot();
    const activePath = join(root, 'active.json');
    let active: SelectorDiscoveryActiveRelease | undefined;
    try {
      active = JSON.parse(await fs.readFile(activePath, 'utf-8')) as SelectorDiscoveryActiveRelease;
    } catch {
      // Fall back to draft while the bundle is still being tuned and active.json is absent or unreadable.
      return join(root, 'draft');
    }

    if (!active.release) {
      return join(root, 'draft');
    }

    if (!active.sha256) {
      throw new Error(`Active selector-discovery release "${active.release}" is missing sha256 in ${activePath}.`);
    }

    const releaseRoot = join(root, 'releases', active.release);
    const actualSha256 = await hashDirectory(releaseRoot);
    if (actualSha256 !== active.sha256) {
      throw new Error(
        `Active selector-discovery release "${active.release}" SHA-256 mismatch. Expected ${active.sha256}, got ${actualSha256}.`
      );
    }

    return releaseRoot;
  }

  private async resolveBundleRoot(): Promise<string> {
    try {
      await fs.access(this.bundleRoot);
      return this.bundleRoot;
    } catch {
      const workspaceRootCandidate = join(process.cwd(), '../agent/ao/selector-discovery');
      await fs.access(workspaceRootCandidate);
      return workspaceRootCandidate;
    }
  }

  private async nextReleaseName(releasesRoot: string): Promise<string> {
    const entries = await fs.readdir(releasesRoot, { withFileTypes: true }).catch(() => []);
    const max = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => /^v(\d+)$/.exec(entry.name)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => Number.parseInt(value, 10))
      .reduce((current, value) => Math.max(current, value), 0);
    return `v${max + 1}`;
  }

  private async readNamedMarkdownFiles(dir: string, model: string): Promise<Array<{ name: string; content: string }>> {
    const entries = await fs.readdir(dir);
    const files = entries.filter((entry) => entry.endsWith('.md')).sort();
    return Promise.all(files.map(async (file) => ({
      name: basename(file, '.md'),
      content: injectModel(await fs.readFile(join(dir, file), 'utf-8'), model),
    })));
  }

  private async readSkills(dir: string): Promise<Array<{ name: string; zip: Buffer }>> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    return Promise.all(skillDirs.map(async (name) => ({
      name,
      zip: createStoredZip([{ name: 'SKILL.md', content: await fs.readFile(join(dir, name, 'SKILL.md'), 'utf-8') }]),
    })));
  }

  private async readContracts(dir: string): Promise<Array<{ path: string; content: string }>> {
    const entries = await fs.readdir(dir);
    const files = entries.filter((entry) => entry.endsWith('.md') || entry.endsWith('.ts')).sort();
    return Promise.all(files.map(async (file) => ({
      path: `contracts/${file}`,
      content: await fs.readFile(join(dir, file), 'utf-8'),
    })));
  }
}

function injectModel(content: string, model: string): string {
  return content.replace(/\{\{MODEL\}\}/g, model);
}

function injectModelIntoConfig(config: Record<string, unknown>, model: string): Record<string, unknown> {
  const agent = config.agent && typeof config.agent === 'object' ? { ...(config.agent as Record<string, unknown>) } : {};
  return {
    ...config,
    agent: {
      ...agent,
      'selector-discovery': {
        ...((agent['selector-discovery'] as Record<string, unknown> | undefined) ?? {}),
        model,
      },
    },
  };
}

function stripProvider(config: Record<string, unknown>): Record<string, unknown> {
  const { provider: _provider, ...rest } = config;
  return rest;
}

async function hashDirectory(root: string): Promise<string> {
  const files = await listFiles(root);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const relativePath = relative(root, file).replace(/\\/g, '/');
    hash.update(relativePath);
    hash.update('\0');
    hash.update(await fs.readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}
