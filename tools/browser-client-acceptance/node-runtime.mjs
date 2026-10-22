import { access, cp, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import WebSocket from 'ws';

export class FileClientStateStore {
  constructor(path) {
    this.path = path;
  }

  async get() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async set(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.path);
  }

  async clear() {
    await rm(this.path, { force: true });
  }
}

export class TemporaryProfileDirectoryAccess {
  constructor() {
    this.ownedDirectories = new Set();
  }

  async createTemporaryDirectory(prefix) {
    const path = await mkdtemp(join(tmpdir(), prefix));
    this.ownedDirectories.add(path);
    return path;
  }

  async removeDirectory(path) {
    if (!this.ownedDirectories.has(path)) {
      throw new Error(`Refusing to remove a profile directory not created by this process: ${path}`);
    }
    this.ownedDirectories.delete(path);
    await rm(path, { recursive: true, force: true });
  }

  async copyChromeProfile(input) {
    assertNotAborted(input.signal);
    await assertProfileUnlocked(input.sourceUserDataRoot);
    const sourceProfilePath = join(input.sourceUserDataRoot, input.sourceProfile);
    await requireProfileDirectory(sourceProfilePath);
    const targetProfilePath = join(input.targetUserDataRoot, input.sourceProfile);
    const excluded = new Set(input.excludedNames);
    await copyProfileDirectory(sourceProfilePath, targetProfilePath, excluded, input.signal);
    await copyLocalState(input.sourceUserDataRoot, input.targetUserDataRoot);
    assertNotAborted(input.signal);
  }
}

async function requireProfileDirectory(path) {
  const sourceStat = await lstat(path).catch(() => undefined);
  if (!sourceStat?.isDirectory()) throw new Error(`Chrome Profile does not exist: ${path}`);
}

async function copyProfileDirectory(source, target, excluded, signal) {
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (entry) => {
      assertNotAborted(signal);
      return !excluded.has(basename(entry));
    },
  });
}

async function copyLocalState(sourceRoot, targetRoot) {
  const source = join(sourceRoot, 'Local State');
  if (await exists(source)) await copyFile(source, join(targetRoot, 'Local State'));
}

export const nodeWebSocketFactory = {
  create(url, protocols) {
    return new WebSocket(url, protocols);
  },
};

async function assertProfileUnlocked(userDataRoot) {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    if (await exists(join(userDataRoot, name))) {
      throw new Error(`Chrome User Data is locked (${name}). Close Chrome before using copy mode.`);
    }
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertNotAborted(signal) {
  if (signal.aborted) throw new Error('Profile preparation was cancelled.');
}
