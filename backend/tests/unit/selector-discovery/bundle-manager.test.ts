import { describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SelectorDiscoveryBundleManager } from '../../../src/selector-discovery/bundle-manager';
import type { ProviderDocument } from '../../../src/selector-discovery/types';

describe('SelectorDiscoveryBundleManager', () => {
  it('freezes draft into a release and makes the frozen release active', async () => {
    const { root, draft } = await createBundleFixture();

    const manager = new SelectorDiscoveryBundleManager(root);
    const frozen = await manager.freezeDraft({ version: 'v1', evalBundleHash: 'a'.repeat(64) });

    expect(frozen.release).toBe('v1');
    expect(frozen.sha256).toMatch(/^[a-f0-9]{64}$/);
    const active = JSON.parse(await readFile(join(root, 'active.json'), 'utf-8')) as {
      release: string;
      sha256: string;
      evalBundleHash: string;
    };
    expect(active.release).toBe('v1');
    expect(active.sha256).toBe(frozen.sha256);
    expect(active.evalBundleHash).toBe('a'.repeat(64));

    await writeFile(join(draft, 'AGENTS.md'), '# Changed draft after freeze\n', 'utf-8');
    const providerDocument: ProviderDocument = {
      provider: {
        local: {
          models: {
            demo: { name: 'demo' },
          },
        },
      },
    };
    const activeBundle = await manager.loadActive(providerDocument, 'local/demo');

    expect(activeBundle.root.endsWith(join('releases', 'v1'))).toBe(true);
    expect(activeBundle.agentConfig).toBe('# Agents\n');
    expect((activeBundle.opencode.provider as Record<string, unknown>).local).toBeDefined();
  });

  it('rejects active releases that were modified after freezing', async () => {
    const { root } = await createBundleFixture();
    const manager = new SelectorDiscoveryBundleManager(root);
    await manager.freezeDraft({ version: 'v1', evalBundleHash: 'a'.repeat(64) });
    await writeFile(join(root, 'releases', 'v1', 'AGENTS.md'), '# Tampered\n', 'utf-8');

    await expect(manager.loadActive(providerDocument(), 'local/demo')).rejects.toThrow(/SHA-256 mismatch/);
  });

  it('rejects active releases that do not declare a sha256', async () => {
    const { root } = await createBundleFixture();
    const manager = new SelectorDiscoveryBundleManager(root);
    await manager.freezeDraft({ version: 'v1', evalBundleHash: 'a'.repeat(64) });
    await writeFile(join(root, 'active.json'), JSON.stringify({ release: 'v1' }), 'utf-8');

    await expect(manager.loadActive(providerDocument(), 'local/demo')).rejects.toThrow(/missing sha256/);
  });

  it('reports draft bundle status when no release is active', async () => {
    const { root } = await createBundleFixture();
    await writeFile(join(root, 'active.json'), JSON.stringify({ release: null }), 'utf-8');
    const manager = new SelectorDiscoveryBundleManager(root);

    const status = await manager.getStatus();

    expect(status.mode).toBe('draft');
    expect(status.verified).toBe(false);
    expect(status.actualSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(status.activeRoot.endsWith('draft')).toBe(true);
  });

  it('reports verified release status and non-throwing mismatch diagnostics', async () => {
    const { root } = await createBundleFixture();
    const manager = new SelectorDiscoveryBundleManager(root);
    const frozen = await manager.freezeDraft({ version: 'v1', evalBundleHash: 'a'.repeat(64) });

    const verified = await manager.getStatus();
    expect(verified.mode).toBe('release');
    expect(verified.release).toBe('v1');
    expect(verified.verified).toBe(true);
    expect(verified.expectedSha256).toBe(frozen.sha256);
    expect(verified.actualSha256).toBe(frozen.sha256);

    await writeFile(join(root, 'releases', 'v1', 'AGENTS.md'), '# Tampered\n', 'utf-8');
    const tampered = await manager.getStatus();
    expect(tampered.mode).toBe('release');
    expect(tampered.verified).toBe(false);
    expect(tampered.error).toMatch(/SHA-256 mismatch/);
  });

  it('loads TypeScript contract templates into the AO bundle', async () => {
    const { root, draft } = await createBundleFixture();
    await writeFile(join(draft, 'contracts', 'common-verification-template.ts'), 'export const template = true;\n', 'utf-8');
    const manager = new SelectorDiscoveryBundleManager(root);

    const bundle = await manager.loadActive(providerDocument(), 'local/demo');

    expect(bundle.contracts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'contracts/common-verification-template.ts',
        content: 'export const template = true;\n',
      }),
    ]));
  });
});

async function createBundleFixture(): Promise<{ root: string; draft: string }> {
  const root = await mkdtemp(join(tmpdir(), 'selector-discovery-bundle-'));
  const draft = join(root, 'draft');
  await mkdir(join(draft, 'agents'), { recursive: true });
  await mkdir(join(draft, 'skills', 'site-analysis'), { recursive: true });
  await mkdir(join(draft, 'contracts'), { recursive: true });
  await writeFile(join(draft, 'opencode.json'), JSON.stringify({ agent: { 'selector-discovery': { model: '{{MODEL}}' } } }), 'utf-8');
  await writeFile(join(draft, 'AGENTS.md'), '# Agents\n', 'utf-8');
  await writeFile(join(draft, 'agents', 'selector-discovery.md'), '---\nmodel: {{MODEL}}\n---\n', 'utf-8');
  await writeFile(join(draft, 'skills', 'site-analysis', 'SKILL.md'), '---\nname: site-analysis\ndescription: test\n---\n', 'utf-8');
  await writeFile(join(draft, 'contracts', 'candidate-output.md'), '# Candidate\n', 'utf-8');
  return { root, draft };
}

function providerDocument(): ProviderDocument {
  return {
    provider: {
      local: {
        models: {
          demo: { name: 'demo' },
        },
      },
    },
  };
}
