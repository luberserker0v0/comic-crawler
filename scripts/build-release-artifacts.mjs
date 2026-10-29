import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '..');

export async function buildReleaseArtifacts(args = process.argv.slice(2)) {
  const options = parseReleaseOptions(args);
  const version = await readProjectVersion();
  const ref = options.ref ?? `v${version}`;
  assertReleaseRef(ref, version);
  await assertSdkMatchesRef(ref);
  const output = resolve(process.cwd(), options.output);
  await mkdir(output, { recursive: true });
  const assets = releaseAssetPaths(output, version);
  await buildAssets(ref, output, assets);
  await writeChecksums(assets.checksums, [assets.sdk, assets.source]);
  printAssets(assets);
}

export function parseReleaseOptions(args) {
  const options = { output: '.artifacts/release', ref: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--output') options.output = requireValue(args, ++index, option);
    else if (option === '--ref') options.ref = requireValue(args, ++index, option);
    else throw new Error(`Unknown option: ${option}`);
  }
  return options;
}

function requireValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

export function assertReleaseRef(ref, version) {
  if (ref !== `v${version}`) {
    throw new Error(`Release ref ${ref} does not match package version ${version}.`);
  }
}

async function readProjectVersion() {
  const text = await readFile(resolve(repositoryRoot, 'package.json'), 'utf8');
  return JSON.parse(text).version;
}

async function assertSdkMatchesRef(ref) {
  try {
    await run('git', ['diff', '--quiet', ref, '--', 'browser-client-sdk', 'shared']);
  } catch {
    throw new Error(`Browser Client SDK sources differ from ${ref}.`);
  }
}

function releaseAssetPaths(output, version) {
  return {
    source: resolve(output, `comiccrawler-v${version}.zip`),
    sdk: resolve(output, `comiccrawler-browser-client-sdk-${version}.tgz`),
    checksums: resolve(output, 'SHA256SUMS.txt'),
  };
}

async function buildAssets(ref, output, assets) {
  await run('npm', ['run', 'build:browser-client-sdk']);
  await run('git', ['archive', '--format=zip', `--prefix=comiccrawler-${ref}/`, `--output=${assets.source}`, ref]);
  await run('npm', ['pack', '--workspace', 'browser-client-sdk', '--pack-destination', output]);
}

async function writeChecksums(destination, files) {
  const lines = [];
  for (const file of files) lines.push(`${await checksumFile(file)}  ${basename(file)}`);
  await writeFile(destination, `${lines.join('\n')}\n`, 'utf8');
}

export async function checksumFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function printAssets(assets) {
  process.stdout.write('Release artifacts:\n');
  for (const path of Object.values(assets)) process.stdout.write(`  ${path}\n`);
}

async function run(command, args) {
  const invocation = resolveInvocation(command, args);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, { cwd: repositoryRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}.`)));
  });
}

function resolveInvocation(command, args) {
  if (command !== 'npm') return { command, args };
  if (!process.env.npm_execpath) throw new Error('Run release packaging through npm run release:artifacts.');
  return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) buildReleaseArtifacts().catch(reportFailure);

function reportFailure(error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
