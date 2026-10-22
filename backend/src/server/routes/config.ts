import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ConfigManager } from '../../config/manager';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

export function setupConfigRoutes(app: FastifyInstance, configManager: ConfigManager): void {
  app.get('/api/config', (_request, reply) => getConfig(reply, configManager));
  app.put('/api/config', (request, reply) => updateConfig(request, reply, configManager));
  app.post('/api/config/reset', (_request, reply) => resetConfig(reply, configManager));
  app.post('/api/config/download-directory/browse', (_request, reply) => browseDirectory(reply));
  app.post('/api/config/download-directory/open', (request, reply) => openDirectory(request, reply, configManager));
  app.get('/api/config/sites', (_request, reply) => listSites(reply, configManager));
  app.get('/api/config/sites/:adapterId', (request, reply) => getSite(request, reply, configManager));
  app.put('/api/config/sites/:adapterId', (request, reply) => updateSite(request, reply, configManager));
  app.get('/api/config/blacklist', (_request, reply) => listBlacklist(reply, configManager));
  app.post('/api/config/blacklist', (request, reply) => addBlacklist(request, reply, configManager));
  app.delete('/api/config/blacklist/:id', (request, reply) => removeBlacklist(request, reply, configManager));
}

async function getConfig(reply: FastifyReply, manager: ConfigManager): Promise<void> {
  reply.send({ data: await manager.get() });
}

async function updateConfig(request: FastifyRequest, reply: FastifyReply, manager: ConfigManager): Promise<void> {
  try { reply.send({ data: await manager.update(request.body as Record<string, unknown>) }); }
  catch (error) { reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
}

async function resetConfig(reply: FastifyReply, manager: ConfigManager): Promise<void> {
  reply.send({ data: await manager.reset() });
}

async function browseDirectory(reply: FastifyReply): Promise<void> {
  reply.send({ data: { directory: await browseDownloadDirectory() } });
}

async function openDirectory(request: FastifyRequest, reply: FastifyReply, manager: ConfigManager): Promise<void> {
  const body = request.body as { directory?: string } | undefined;
  const directory = body?.directory?.trim() || (await manager.get()).download.directory;
  await openDownloadDirectory(directory);
  reply.send({ data: { directory: resolve(directory) } });
}

async function listSites(reply: FastifyReply, manager: ConfigManager): Promise<void> {
  reply.send({ data: await manager.getAllSiteConfigs() });
}

async function getSite(request: FastifyRequest, reply: FastifyReply, manager: ConfigManager): Promise<void> {
  const site = await manager.getSiteConfig(routeParam(request, 'adapterId'));
  if (!site) return void reply.code(404).send({ error: 'Site config not found' });
  reply.send({ data: site });
}

async function updateSite(request: FastifyRequest, reply: FastifyReply, manager: ConfigManager): Promise<void> {
  const adapterId = routeParam(request, 'adapterId');
  await manager.setSiteConfig(adapterId, { adapterId, enabled: true,
    ...(request.body as Record<string, unknown>) } as any);
  reply.send({ data: { message: 'Site config updated' } });
}

async function listBlacklist(reply: FastifyReply, manager: ConfigManager): Promise<void> {
  reply.send({ data: await manager.getBlacklist() });
}

async function addBlacklist(request: FastifyRequest, reply: FastifyReply, manager: ConfigManager): Promise<void> {
  const body = request.body as { id: string; type: 'chapter' | 'tag'; pattern: string; adapterId?: string };
  await manager.addBlacklistRule(body);
  reply.code(201).send({ data: { message: 'Blacklist rule added' } });
}

async function removeBlacklist(request: FastifyRequest, reply: FastifyReply, manager: ConfigManager): Promise<void> {
  await manager.removeBlacklistRule(routeParam(request, 'id'));
  reply.send({ data: { message: 'Blacklist rule removed' } });
}

function routeParam(request: FastifyRequest, key: string): string {
  return (request.params as Record<string, string>)[key]!;
}

async function browseDownloadDirectory(): Promise<string | null> {
  if (process.platform !== 'win32') {
    throw new Error('Folder browsing is currently only available on Windows. Enter the download directory manually.');
  }

  return runFolderPicker(`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select ComicCrawler download directory'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
`);
}

function runFolderPicker(script: string): Promise<string | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => completeFolderPicker(code, stdout, stderr, resolvePromise, reject));
  });
}

function completeFolderPicker(code: number | null, stdout: string, stderr: string,
  resolvePromise: (value: string | null) => void, reject: (error: Error) => void): void {
  if (code !== 0) return reject(new Error(stderr.trim() || `Folder picker exited with code ${code}.`));
  resolvePromise(stdout.trim() || null);
}

async function openDownloadDirectory(directory: string): Promise<void> {
  const resolved = resolve(directory);
  if (!existsSync(resolved)) {
    await mkdir(resolved, { recursive: true });
  }

  const command = process.platform === 'win32' ? 'explorer.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  await spawnDirectoryOpener(command, resolved);
}

function spawnDirectoryOpener(command: string, directory: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [directory], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolvePromise(); });
  });
}
