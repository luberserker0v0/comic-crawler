import { createHash, generateKeyPairSync } from 'node:crypto';
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_KEY_NAME = 'comiccrawler-official-2026-10';
const DIVIDER = '-'.repeat(68);

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return printHelp();
  const repository = resolve(import.meta.dirname, '..');
  const backup = resolve(options.backupDirectory);
  warnForRepositoryDirectory(backup, repository);
  assertKeyName(options.keyName);
  printSecurityNotice(options.keyName, backup);
  const paths = keyPaths(backup, options.keyName);
  await mkdir(backup, { recursive: true });
  await assertTargetsWritable(Object.values(paths), options.force);
  await writeKeyBundle(paths, options.keyName, options.force);
  printResult(paths, options.keyName);
}

function parseArguments(args) {
  const options = { backupDirectory: invocationDirectory(),
    keyName: DEFAULT_KEY_NAME, force: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--force') options.force = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--backup-directory') options.backupDirectory = requireValue(args, ++index, argument);
    else if (argument === '--key-name') options.keyName = requireValue(args, ++index, argument);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function invocationDirectory() {
  return resolve(process.env.INIT_CWD || process.cwd());
}

function requireValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function warnForRepositoryDirectory(directory, repository) {
  const path = relative(repository, directory);
  if (!path || (!path.startsWith('..') && !isAbsolute(path))) {
    process.stderr.write('Warning: key files are inside the repository; move the private key to encrypted backup storage.\n');
  }
}

function assertKeyName(value) {
  if (!/^[A-Za-z0-9._-]+$/.test(value))
    throw new Error('Key name may contain only letters, digits, dot, underscore, and hyphen.');
}

function keyPaths(directory, keyName) {
  return { privateKey: join(directory, `${keyName}.private.pem`),
    publicKey: join(directory, `${keyName}.public.pem`),
    metadata: join(directory, `${keyName}.metadata.json`) };
}

async function assertTargetsWritable(paths, force) {
  if (force) return;
  for (const path of paths) {
    try { await access(path); throw new Error(`Refusing to overwrite ${path}; use --force.`); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function writeKeyBundle(paths, keyName, force) {
  const keys = generateKeyPairSync('ed25519');
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const flag = force ? 'w' : 'wx';
  await writeFile(paths.privateKey, privatePem, { encoding: 'utf-8', flag, mode: 0o600 });
  try { await writePublicFiles(paths, keyName, publicPem, flag); }
  catch (error) { throw addPartialWriteContext(error, paths.privateKey); }
  await chmod(paths.privateKey, 0o600);
}

async function writePublicFiles(paths, keyName, publicPem, flag) {
  await writeFile(paths.publicKey, publicPem, { encoding: 'utf-8', flag, mode: 0o644 });
  const metadata = createMetadata(paths, keyName, publicPem);
  await writeFile(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`,
    { encoding: 'utf-8', flag, mode: 0o644 });
}

function createMetadata(paths, keyName, publicPem) {
  return { schemaVersion: 1, algorithm: 'ed25519', keyId: keyName,
    createdAt: new Date().toISOString(), publicKeyFile: basename(paths.publicKey),
    privateKeyFile: basename(paths.privateKey),
    publicKeyFileSha256: createHash('sha256').update(publicPem).digest('hex'),
    githubSecretName: 'ADAPTER_REGISTRY_PRIVATE_KEY',
    githubKeyIdVariable: 'ADAPTER_REGISTRY_KEY_ID' };
}

function addPartialWriteContext(error, privateKeyPath) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${message} Private key may already exist at ${privateKeyPath}; inspect it before retrying.`);
}

function printResult(paths, keyName) {
  process.stdout.write(`${DIVIDER}\nRegistry signing key created.\n`);
  process.stdout.write(`key_name / keyId: ${keyName}\n`);
  process.stdout.write(`Private backup: ${paths.privateKey}\nPublic key: ${paths.publicKey}\n`);
  process.stdout.write(`Metadata: ${paths.metadata}\nGitHub Secret: ADAPTER_REGISTRY_PRIVATE_KEY\n`);
  process.stdout.write(`GitHub Variable: ADAPTER_REGISTRY_KEY_ID=${keyName}\n`);
  process.stdout.write(`Do not commit or publish the private PEM file.\n${DIVIDER}\n`);
}

function printSecurityNotice(keyName, backup) {
  process.stdout.write(`${DIVIDER}\nComicCrawler Adapter Registry Key Generator\n${DIVIDER}\n`);
  process.stdout.write('Private key : keep a local encrypted backup and save its full contents in GitHub Secret\n');
  process.stdout.write('              ADAPTER_REGISTRY_PRIVATE_KEY. Never commit or publish it.\n');
  process.stdout.write('Public key  : keep locally; it may be published and is used by Server trust stores.\n');
  process.stdout.write('Metadata    : records keyId and public-key fingerprint; it contains no private key.\n');
  process.stdout.write(`key_name    : ${keyName}\nOutput       : ${backup}\n${DIVIDER}\n`);
}

function printHelp() {
  process.stdout.write('Usage: npm run registry:keygen -- [options]\n\n');
  process.stdout.write('Options:\n  --backup-directory <path>  Default: command invocation directory\n');
  process.stdout.write(`  --key-name <name>         Default: ${DEFAULT_KEY_NAME}\n`);
  process.stdout.write('  --force            Overwrite the three target files\n  -h, --help         Show this help\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
