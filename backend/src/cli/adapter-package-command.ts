import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AdapterCatalogEntry, AdapterPackageDocument } from '@comiccrawler/shared';
import { formatError } from '../error/types';
import { importAdapterPackage, inspectAdapterPackage } from '../adapter/package-transfer';
import { createAdapterPackage } from '../adapter/package-builder';
import { resolveProjectAdapterSourcePath } from '../adapter/runtime-state';
import { instantiateAdapterImplementationDraft } from '../selector-discovery/adapter-draft-runtime';
import { validateAdapterImplementationDraft } from '../selector-discovery/adapter-implementation';
import type { CliCommandContext } from './command-context';

const MAX_PACKAGE_BYTES = 5_500_000;

export function setupAdapterPackageCommand(ctx: CliCommandContext): void {
  const command = ctx.program.command('adapter-packages')
    .description('Inspect, export, and import reviewed adapter packages');
  command.command('list').description('List catalog package versions').action(() => listPackages(ctx));
  command.command('inspect').argument('<file>').description('Validate a package without executing it')
    .action((file: string) => inspectPackageFile(ctx, file));
  command.command('export').argument('<adapter-id>').description('Export an immutable package as JSON')
    .option('--version <version>').option('-o, --output <file>').option('--force')
    .action((id: string, options: ExportOptions) => exportPackage(ctx, id, options));
  command.command('build-project').argument('<adapter-id>')
    .description('Build a portable package from a project-source adapter')
    .requiredOption('--created-at <timestamp>').option('-o, --output <file>').option('--force')
    .action((id: string, options: BuildProjectOptions) => buildProjectPackage(ctx, id, options));
  command.command('import').argument('<file>').description('Validate and install a package without activation')
    .option('--activate', 'Activate the imported package after validation')
    .action((file: string, options: { activate?: boolean }) => importPackageFile(ctx, file, options));
}

interface ExportOptions { version?: string; output?: string; force?: boolean }
interface BuildProjectOptions { createdAt: string; output?: string; force?: boolean }

async function listPackages(ctx: CliCommandContext): Promise<void> {
  await runPackageCommand(ctx, async () => {
    const entries = await requireCatalog(ctx).listEntries();
    const rows = entries.flatMap(packageRows);
    if (!rows.length) return ctx.ui.renderInfo('No adapter packages are installed.');
    ctx.ui.renderTable(['adapter', 'version', 'status', 'origin'], rows);
  });
}

function packageRows(entry: AdapterCatalogEntry): string[][] {
  return entry.versions.map((version) => [entry.adapterId, version.version, version.status, version.origin]);
}

async function inspectPackageFile(ctx: CliCommandContext, file: string): Promise<void> {
  await runPackageCommand(ctx, async () => {
    const { inspection } = inspectAdapterPackage(await readPackageFile(file));
    renderInspection(ctx, inspection);
    ctx.ui.renderSuccess('Adapter package is valid. No package code was executed.');
  });
}

async function exportPackage(ctx: CliCommandContext, id: string, options: ExportOptions): Promise<void> {
  await runPackageCommand(ctx, async () => {
    const catalog = requireCatalog(ctx);
    const entry = await catalog.getEntry(id);
    const version = options.version ?? entry?.activeVersion;
    if (!version) throw new Error(`Adapter "${id}" has no active package; specify --version.`);
    const document = await catalog.getPackage(id, version);
    if (!document) throw new Error(`Adapter package ${id}@${version} was not found.`);
    inspectAdapterPackage(document);
    const output = resolve(options.output ?? `${id}-${version}.ccadapter.json`);
    await writePackageFile(output, document, Boolean(options.force));
    ctx.ui.renderSuccess(`Exported ${id}@${version} to ${output}`);
  });
}

async function buildProjectPackage(
  ctx: CliCommandContext, id: string, options: BuildProjectOptions
): Promise<void> {
  await runPackageCommand(ctx, async () => {
    const sourcePath = resolveProjectAdapterSourcePath(id);
    if (!sourcePath) throw new Error(`Project-source adapter "${id}" was not found.`);
    const source = await readFile(sourcePath, 'utf-8');
    const adapter = instantiateAdapterImplementationDraft(source);
    if (adapter.id !== id) throw new Error(`Project-source adapter identity is "${adapter.id}", not "${id}".`);
    const validation = validateAdapterImplementationDraft(source,
      { target: adapter.capabilities?.metadata ? 'full' : 'chapter-only' });
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const document = createAdapterPackage({ adapter, implementationTs: source,
      origin: 'bundled', createdAt: options.createdAt, validation });
    inspectAdapterPackage(document);
    const output = resolve(options.output ?? `${id}-${document.manifest.version}.ccadapter.json`);
    await writePackageFile(output, document, Boolean(options.force));
    ctx.ui.renderSuccess(`Built portable package ${id}@${document.manifest.version} at ${output}`);
  });
}

async function importPackageFile(
  ctx: CliCommandContext, file: string, options: { activate?: boolean }
): Promise<void> {
  await runPackageCommand(ctx, async () => {
    const result = await importAdapterPackage(requireCatalog(ctx), ctx.options.adapterRegistry,
      await readPackageFile(file), Boolean(options.activate));
    renderInspection(ctx, result.inspection);
    const state = options.activate ? 'installed and activated' : 'installed but not activated';
    ctx.ui.renderSuccess(`Adapter package ${state}.`);
  });
}

async function readPackageFile(file: string): Promise<unknown> {
  const absolutePath = resolve(file);
  if ((await stat(absolutePath)).size > MAX_PACKAGE_BYTES) throw new Error('Adapter package exceeds 5.5 MB.');
  return JSON.parse(await readFile(absolutePath, 'utf-8')) as unknown;
}

async function writePackageFile(path: string, document: AdapterPackageDocument, force: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf-8', flag: force ? 'w' : 'wx' });
}

function requireCatalog(ctx: CliCommandContext) {
  if (!ctx.options.adapterCatalog) throw new Error('Adapter Catalog is not available.');
  return ctx.options.adapterCatalog;
}

function renderInspection(ctx: CliCommandContext, value: ReturnType<typeof inspectAdapterPackage>['inspection']): void {
  ctx.ui.renderTable(['field', 'value'], [['adapter', value.adapterId], ['version', value.version],
    ['name', value.name], ['domains', value.domains.join(', ')], ['origin', value.origin],
    ['source', value.sourceValid ? 'valid' : 'invalid']]);
}

async function runPackageCommand(ctx: CliCommandContext, action: () => Promise<void>): Promise<void> {
  try { await action(); }
  catch (error) { ctx.ui.renderError(formatError(error)); process.exitCode = 1; }
}
