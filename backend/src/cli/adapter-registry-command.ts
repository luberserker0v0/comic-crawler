import type { AdapterRegistryUpdate } from '@comiccrawler/shared';
import type { Dirent } from 'node:fs';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { formatError } from '../error/types';
import type { OfficialAdapterRegistryService } from '../adapter/official-registry';
import { buildAdapterRegistryRelease, deriveRegistryPublicKey,
  generateRegistrySigningKeyPair } from '../adapter/registry-publisher';
import type { CliCommandContext } from './command-context';

interface RegistryOptions { registry?: string; version?: string; activate?: boolean }
interface PublishOptions { output: string; registryId: string; baseUrl: string; keyId: string;
  privateKey: string; timestamp?: string; force?: boolean }
interface KeygenOptions { privateKey: string; publicKey: string; force?: boolean }
interface PublicKeyOptions { privateKey: string; output: string; force?: boolean }
const MAX_PACKAGE_BYTES = 5_500_000;

export function setupAdapterRegistryCommand(ctx: CliCommandContext): void {
  const command = ctx.program.command('adapter-registry')
    .description('Query and install packages from signed adapter registries');
  setupConsumerCommands(ctx, command);
  setupPublisherCommands(ctx, command);
}

function setupConsumerCommands(ctx: CliCommandContext, command: ReturnType<CliCommandContext['program']['command']>): void {
  command.command('list').description('List verified remote packages')
    .action(() => runRegistryCommand(ctx, async (service) => renderUpdates(ctx, await service.list())));
  command.command('check').argument('[adapter-id]').description('List available package updates')
    .action((id?: string) => runRegistryCommand(ctx, async (service) => renderUpdates(ctx, await service.check(id))));
  command.command('install').argument('<adapter-id>').option('--registry <id>').option('--version <version>')
    .option('--activate', 'Activate after verified installation')
    .action((id: string, options: RegistryOptions) => installPackage(ctx, id, options));
  command.command('update').argument('[adapter-id]').option('--activate', 'Activate installed updates')
    .action((id: string | undefined, options: RegistryOptions) => updatePackages(ctx, id, options));
}

function setupPublisherCommands(ctx: CliCommandContext, command: ReturnType<CliCommandContext['program']['command']>): void {
  command.command('publish').argument('<files...>').requiredOption('--output <directory>')
    .requiredOption('--registry-id <id>').requiredOption('--base-url <url>')
    .requiredOption('--key-id <id>').requiredOption('--private-key <file>')
    .option('--timestamp <date-time>').option('--force', 'Overwrite matching generated artifacts')
    .description('Build a signed static registry release from reviewed packages')
    .action((files: string[], options: PublishOptions) => publishRegistry(ctx, files, options));
  command.command('keygen').requiredOption('--private-key <file>').requiredOption('--public-key <file>')
    .option('--force', 'Overwrite both key files').description('Generate an Ed25519 registry signing key pair')
    .action((options: KeygenOptions) => generateSigningKeys(ctx, options));
  command.command('public-key').requiredOption('--private-key <file>').requiredOption('--output <file>')
    .option('--force', 'Overwrite the public key file').description('Derive the public key from an Ed25519 private key')
    .action((options: PublicKeyOptions) => derivePublicKey(ctx, options));
}

async function installPackage(ctx: CliCommandContext, adapterId: string,
  options: RegistryOptions): Promise<void> {
  await runRegistryCommand(ctx, async (service) => {
    const result = await service.install({ registryId: options.registry, adapterId,
      version: options.version, activate: options.activate });
    renderUpdates(ctx, [result]);
    ctx.ui.renderSuccess(`Installed ${result.package.adapterId}@${result.package.version}.`);
  });
}

async function updatePackages(ctx: CliCommandContext, adapterId: string | undefined,
  options: RegistryOptions): Promise<void> {
  await runRegistryCommand(ctx, async (service) => {
    const results = await service.update(adapterId, Boolean(options.activate));
    renderUpdates(ctx, results);
    ctx.ui.renderSuccess(results.length ? `Installed ${results.length} update(s).` : 'No updates are available.');
  });
}

function renderUpdates(ctx: CliCommandContext, items: AdapterRegistryUpdate[]): void {
  if (!items.length) return ctx.ui.renderInfo('No adapter packages found.');
  ctx.ui.renderTable(['registry', 'adapter', 'version', 'installed', 'active'], items.map((item) => [
    item.registryId, item.package.adapterId, item.package.version,
    String(item.installed), String(item.active),
  ]));
}

async function runRegistryCommand(ctx: CliCommandContext,
  action: (service: OfficialAdapterRegistryService) => Promise<void>): Promise<void> {
  try { await action(requireService(ctx)); }
  catch (error) { ctx.ui.renderError(formatError(error)); process.exitCode = 1; }
}

function requireService(ctx: CliCommandContext): OfficialAdapterRegistryService {
  if (!ctx.options.officialAdapterRegistry) throw new Error('Official Adapter Registry is not available.');
  return ctx.options.officialAdapterRegistry;
}

async function publishRegistry(ctx: CliCommandContext, files: string[], options: PublishOptions): Promise<void> {
  await runPublisherCommand(ctx, async () => {
    const packageFiles = (await Promise.all(files.map(collectPackageFiles))).flat();
    const values = await Promise.all(packageFiles.map(readPackageJson));
    const output = resolve(options.output);
    const privateKeyPath = resolve(options.privateKey);
    assertSecretOutsideOutput(privateKeyPath, output);
    const privateKeyPem = await readFile(privateKeyPath, 'utf-8');
    const release = buildAdapterRegistryRelease(values, { ...options, privateKeyPem });
    await writeRelease(output, release, Boolean(options.force));
    ctx.ui.renderSuccess(`Published ${release.packages.length} package(s) and signed index.json.`);
  });
}

async function collectPackageFiles(path: string): Promise<string[]> {
  const absolutePath = resolve(path);
  const details = await stat(absolutePath);
  if (details.isFile()) return [absolutePath];
  if (!details.isDirectory()) return [];
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => collectEntryFiles(absolutePath, entry)));
  return nested.flat().sort();
}

async function collectEntryFiles(parent: string,
  entry: Dirent): Promise<string[]> {
  const path = join(parent, entry.name);
  if (entry.isDirectory()) return collectPackageFiles(path);
  return entry.isFile() && entry.name.endsWith('.ccadapter.json') ? [path] : [];
}

async function generateSigningKeys(ctx: CliCommandContext, options: KeygenOptions): Promise<void> {
  await runPublisherCommand(ctx, async () => {
    const privatePath = resolve(options.privateKey);
    const publicPath = resolve(options.publicKey);
    if (privatePath === publicPath) throw new Error('Private and public key paths must be different.');
    await assertTargetsWritable([privatePath, publicPath], Boolean(options.force));
    const keys = generateRegistrySigningKeyPair();
    await Promise.all([writeText(privatePath, keys.privateKeyPem, options.force, 0o600),
      writeText(publicPath, keys.publicKeyPem, options.force, 0o644)]);
    ctx.ui.renderSuccess(`Generated signing keys at ${privatePath} and ${publicPath}.`);
  });
}

async function derivePublicKey(ctx: CliCommandContext, options: PublicKeyOptions): Promise<void> {
  await runPublisherCommand(ctx, async () => {
    const output = resolve(options.output);
    const privateKeyPem = await readFile(resolve(options.privateKey), 'utf-8');
    await assertTargetsWritable([output], Boolean(options.force));
    await writeText(output, deriveRegistryPublicKey(privateKeyPem), options.force, 0o644);
    ctx.ui.renderSuccess(`Derived registry public key at ${output}.`);
  });
}

function assertSecretOutsideOutput(privateKeyPath: string, output: string): void {
  const path = relative(output, privateKeyPath);
  if (!path || (!path.startsWith('..') && !isAbsolute(path)))
    throw new Error('Private key path must be outside the registry output directory.');
}

async function readPackageJson(path: string): Promise<unknown> {
  const absolutePath = resolve(path);
  if ((await stat(absolutePath)).size > MAX_PACKAGE_BYTES) throw new Error(`Package ${absolutePath} exceeds 5.5 MB.`);
  return JSON.parse(await readFile(absolutePath, 'utf-8')) as unknown;
}

async function writeRelease(output: string, release: ReturnType<typeof buildAdapterRegistryRelease>,
  force: boolean): Promise<void> {
  const targets = release.packages.map((item) => join(output, ...item.path.split('/')));
  const indexPath = join(output, 'index.json');
  await assertTargetsWritable([...targets, indexPath], force);
  await Promise.all(release.packages.map((item, index) =>
    writeJson(targets[index], item.envelope, force)));
  await writeJson(indexPath, release.index, force);
}

async function assertTargetsWritable(paths: string[], force: boolean): Promise<void> {
  if (force) return;
  for (const path of paths) {
    if (await exists(path)) throw new Error(`Refusing to overwrite ${path}; use --force.`);
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}

async function writeJson(path: string, value: unknown, force: boolean): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`, force, 0o644);
}

async function writeText(path: string, value: string, force = false, mode = 0o644): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { encoding: 'utf-8', flag: force ? 'w' : 'wx', mode });
}

async function runPublisherCommand(ctx: CliCommandContext, action: () => Promise<void>): Promise<void> {
  try { await action(); }
  catch (error) { ctx.ui.renderError(formatError(error)); process.exitCode = 1; }
}
