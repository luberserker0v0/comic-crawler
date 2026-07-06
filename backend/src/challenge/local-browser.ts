import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export interface LocalBrowserProfile {
  id: string;
  name: string;
  directory?: string;
  launchValue: string;
}

export interface LocalBrowserOption {
  id: string;
  name: string;
  family: 'chromium' | 'firefox' | 'unknown';
  executablePath: string;
  userDataDir?: string;
  profiles: LocalBrowserProfile[];
  defaultProfileId?: string;
}

export interface OpenLocalBrowserInput {
  url: string;
  executablePath?: string;
  profileId?: string;
  userDataDir?: string;
}

export interface OpenLocalBrowserResult {
  cdpUrl?: string;
  warning?: string;
  userDataDir?: string;
  profileDirectory?: string;
}

interface BrowserCandidate {
  id: string;
  name: string;
  family: LocalBrowserOption['family'];
  executablePaths: string[];
  userDataDir?: string;
}

export function discoverLocalBrowsers(): LocalBrowserOption[] {
  const candidates = getBrowserCandidates();
  const browsers: LocalBrowserOption[] = [];
  for (const candidate of candidates) {
      const executablePath = candidate.executablePaths.find((path) => existsSync(path));
    if (!executablePath) continue;
      const profiles = candidate.family === 'firefox'
        ? discoverFirefoxProfiles(candidate.id)
        : discoverChromiumProfiles(candidate.id, candidate.userDataDir);
    browsers.push({
        id: candidate.id,
        name: candidate.name,
        family: candidate.family,
        executablePath,
        userDataDir: candidate.userDataDir,
        profiles,
        defaultProfileId: profiles[0]?.id,
    });
  }
  return browsers;
}

export async function openLocalBrowser(input: OpenLocalBrowserInput): Promise<OpenLocalBrowserResult> {
  const url = input.url;
  if (!input.executablePath) {
    await openWithSystemBrowser(url);
    return {};
  }

  const executablePath = resolve(input.executablePath);
  if (!existsSync(executablePath)) {
    throw new Error(`Browser executable does not exist: ${executablePath}`);
  }

  const browser = discoverLocalBrowsers().find((candidate) => samePath(candidate.executablePath, executablePath));
  const profile = browser?.profiles.find((candidate) => candidate.id === input.profileId);
  const cdpPort = browser?.family === 'chromium' ? await findFreePort() : undefined;
  const explicitUserDataDir = input.userDataDir ? resolve(input.userDataDir) : undefined;
  const launchUserDataDir = explicitUserDataDir ?? (browser?.family === 'chromium' && profile && browser.userDataDir ? resolve(browser.userDataDir) : undefined);
  if (explicitUserDataDir) {
    mkdirSync(explicitUserDataDir, { recursive: true });
  }
  const args = buildLaunchArgs(url, browser?.family ?? 'unknown', profile, cdpPort, launchUserDataDir);

  await spawnDetached(executablePath, args);
  if (!cdpPort) {
    return {
      userDataDir: launchUserDataDir ?? browser?.userDataDir,
      profileDirectory: profile?.launchValue,
    };
  }

  const cdpUrl = `http://127.0.0.1:${cdpPort}`;
  const ready = await waitForCdpReady(cdpUrl, 15000);
  if (!ready) {
    return {
      userDataDir: launchUserDataDir ?? browser?.userDataDir,
      profileDirectory: profile?.launchValue,
      warning: [
        `Opened the browser, but ComicCrawler could not connect to ${cdpUrl}.`,
        'If this browser/profile was already running, Chromium usually ignores the new remote-debugging port.',
        'Close all windows for that browser/profile, then open it again from ComicCrawler.',
      ].join(' '),
    };
  }

  return {
    cdpUrl,
    userDataDir: launchUserDataDir ?? browser?.userDataDir,
    profileDirectory: profile?.launchValue,
  };
}

export async function browseLocalBrowserExecutable(): Promise<string | null> {
  if (process.platform !== 'win32') {
    throw new Error('Executable browsing is currently only available on Windows. Enter the browser executable path manually.');
  }

  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select browser executable'
$dialog.Filter = 'Executable (*.exe)|*.exe|All files (*.*)|*.*'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.FileName
}
`;

  return new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Browser executable picker exited with code ${code}.`));
        return;
      }
      resolvePromise(stdout.trim() || null);
    });
  });
}

async function openWithSystemBrowser(url: string): Promise<void> {
  const command = process.platform === 'win32'
    ? 'cmd.exe'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  const args = process.platform === 'win32'
    ? ['/c', 'start', '', url]
    : [url];

  await spawnDetached(command, args);
}

async function spawnDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolvePromise();
    });
  });
}

function buildLaunchArgs(
  url: string,
  family: LocalBrowserOption['family'],
  profile?: LocalBrowserProfile,
  cdpPort?: number,
  userDataDir?: string
): string[] {
  const cdpArgs = cdpPort
    ? [`--remote-debugging-port=${cdpPort}`, '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*']
    : [];
  if (family === 'chromium' && userDataDir) {
    return [
      ...cdpArgs,
      `--user-data-dir=${userDataDir}`,
      ...(profile?.launchValue ? [`--profile-directory=${profile.launchValue}`] : []),
      '--no-first-run',
      '--new-window',
      url,
    ];
  }
  if (family === 'chromium' && profile?.launchValue) {
    return [...cdpArgs, `--profile-directory=${profile.launchValue}`, url];
  }
  if (family === 'firefox' && profile?.directory) {
    return ['-profile', profile.directory, url];
  }
  return [...cdpArgs, url];
}

async function findFreePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolvePromise(address.port);
        } else {
          reject(new Error('Unable to allocate a local debugging port.'));
        }
      });
    });
    server.once('error', reject);
  });
}

async function waitForCdpReady(cdpUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpUrl}/json/version`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Browser may still be starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return false;
}

function getBrowserCandidates(): BrowserCandidate[] {
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const appData = process.env.APPDATA ?? '';
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';

  if (process.platform === 'win32') {
    return [
      {
        id: 'chrome',
        name: 'Google Chrome',
        family: 'chromium',
        executablePaths: [
          join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ],
        userDataDir: join(localAppData, 'Google', 'Chrome', 'User Data'),
      },
      {
        id: 'edge',
        name: 'Microsoft Edge',
        family: 'chromium',
        executablePaths: [
          join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ],
        userDataDir: join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      },
      {
        id: 'brave',
        name: 'Brave',
        family: 'chromium',
        executablePaths: [
          join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        ],
        userDataDir: join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      },
      {
        id: 'vivaldi',
        name: 'Vivaldi',
        family: 'chromium',
        executablePaths: [
          join(localAppData, 'Vivaldi', 'Application', 'vivaldi.exe'),
          join(programFiles, 'Vivaldi', 'Application', 'vivaldi.exe'),
        ],
        userDataDir: join(localAppData, 'Vivaldi', 'User Data'),
      },
      {
        id: 'firefox',
        name: 'Mozilla Firefox',
        family: 'firefox',
        executablePaths: [
          join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
          join(programFilesX86, 'Mozilla Firefox', 'firefox.exe'),
        ],
        userDataDir: join(appData, 'Mozilla', 'Firefox'),
      },
    ];
  }

  return [
    { id: 'chrome', name: 'Google Chrome', family: 'chromium', executablePaths: ['/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] },
    { id: 'chromium', name: 'Chromium', family: 'chromium', executablePaths: ['/usr/bin/chromium', '/usr/bin/chromium-browser'] },
    { id: 'firefox', name: 'Mozilla Firefox', family: 'firefox', executablePaths: ['/usr/bin/firefox', '/Applications/Firefox.app/Contents/MacOS/firefox'] },
  ];
}

function discoverChromiumProfiles(browserId: string, userDataDir?: string): LocalBrowserProfile[] {
  if (!userDataDir || !existsSync(userDataDir)) {
    return [{ id: `${browserId}:Default`, name: 'Default', launchValue: 'Default' }];
  }

  const localState = readChromiumLocalState(userDataDir);
  const profileNames = localState?.profile?.info_cache ?? {};
  const directories = readdirSync(userDataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === 'Default' || /^Profile \d+$/i.test(name))
    .sort((a, b) => profileSortKey(a) - profileSortKey(b));

  if (directories.length === 0) {
    directories.push('Default');
  }

  return directories.map((directory) => ({
    id: `${browserId}:${directory}`,
    name: profileNames[directory]?.name ? `${profileNames[directory].name} (${directory})` : directory,
    directory: join(userDataDir, directory),
    launchValue: directory,
  }));
}

function discoverFirefoxProfiles(browserId: string): LocalBrowserProfile[] {
  const appData = process.env.APPDATA;
  if (!appData) {
    return [{ id: `${browserId}:default`, name: 'Default', launchValue: 'default' }];
  }
  const profilesIni = join(appData, 'Mozilla', 'Firefox', 'profiles.ini');
  if (!existsSync(profilesIni)) {
    return [{ id: `${browserId}:default`, name: 'Default', launchValue: 'default' }];
  }

  const content = readFileSync(profilesIni, 'utf8');
  const sections = content.split(/\r?\n\s*\[/).map((section, index) => index === 0 ? section : `[${section}`);
  const profiles = sections
    .map(parseFirefoxProfileSection)
    .filter((profile): profile is { name: string; path: string; isRelative: boolean } => Boolean(profile))
    .map((profile) => {
      const directory = profile.isRelative
        ? join(appData, 'Mozilla', 'Firefox', profile.path)
        : profile.path;
      return {
        id: `${browserId}:${basename(directory)}`,
        name: profile.name,
        directory,
        launchValue: directory,
      };
    });

  return profiles.length > 0 ? profiles : [{ id: `${browserId}:default`, name: 'Default', launchValue: 'default' }];
}

function parseFirefoxProfileSection(section: string): { name: string; path: string; isRelative: boolean } | null {
  if (!/^\[Profile\d+\]/m.test(section)) return null;
  const name = section.match(/^Name=(.+)$/m)?.[1]?.trim();
  const path = section.match(/^Path=(.+)$/m)?.[1]?.trim();
  const isRelative = section.match(/^IsRelative=(.+)$/m)?.[1]?.trim() !== '0';
  if (!name || !path) return null;
  return { name, path, isRelative };
}

function readChromiumLocalState(userDataDir: string): { profile?: { info_cache?: Record<string, { name?: string }> } } | null {
  try {
    return JSON.parse(readFileSync(join(userDataDir, 'Local State'), 'utf8'));
  } catch {
    return null;
  }
}

function profileSortKey(name: string): number {
  if (name === 'Default') return 0;
  const match = name.match(/^Profile (\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLocaleLowerCase() === resolve(b).toLocaleLowerCase();
}
