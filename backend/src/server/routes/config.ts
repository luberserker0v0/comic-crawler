import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ConfigManager } from '../../config/manager';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

export function setupConfigRoutes(app: FastifyInstance, configManager: ConfigManager): void {
  app.get('/api/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = await configManager.get();
    reply.send({ data: config });
  });

  app.put('/api/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    const updated = await configManager.update(body);
    reply.send({ data: updated });
  });

  app.post('/api/config/reset', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = await configManager.reset();
    reply.send({ data: config });
  });

  app.post('/api/config/download-directory/browse', async (_request: FastifyRequest, reply: FastifyReply) => {
    const directory = await browseDownloadDirectory();
    reply.send({ data: { directory } });
  });

  app.post('/api/config/download-directory/open', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { directory?: string } | undefined;
    const config = await configManager.get();
    const directory = body?.directory?.trim() || config.download.directory;
    await openDownloadDirectory(directory);
    reply.send({ data: { directory: resolve(directory) } });
  });

  app.get('/api/config/sites', async (_request: FastifyRequest, reply: FastifyReply) => {
    const sites = await configManager.getAllSiteConfigs();
    reply.send({ data: sites });
  });

  app.get('/api/config/sites/:adapterId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { adapterId } = request.params as { adapterId: string };
    const site = await configManager.getSiteConfig(adapterId);

    if (!site) {
      reply.code(404).send({ error: 'Site config not found' });
      return;
    }

    reply.send({ data: site });
  });

  app.put('/api/config/sites/:adapterId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { adapterId } = request.params as { adapterId: string };
    const body = request.body as Record<string, unknown>;

    await configManager.setSiteConfig(adapterId, {
      adapterId,
      enabled: true,
      ...body,
    } as any);

    reply.send({ data: { message: 'Site config updated' } });
  });

  app.get('/api/config/blacklist', async (_request: FastifyRequest, reply: FastifyReply) => {
    const rules = await configManager.getBlacklist();
    reply.send({ data: rules });
  });

  app.post('/api/config/blacklist', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { id: string; type: 'chapter' | 'tag'; pattern: string; adapterId?: string };

    await configManager.addBlacklistRule(body);
    reply.code(201).send({ data: { message: 'Blacklist rule added' } });
  });

  app.delete('/api/config/blacklist/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await configManager.removeBlacklistRule(id);
    reply.send({ data: { message: 'Blacklist rule removed' } });
  });
}

async function browseDownloadDirectory(): Promise<string | null> {
  if (process.platform !== 'win32') {
    throw new Error('Folder browsing is currently only available on Windows. Enter the download directory manually.');
  }

  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select ComicCrawler download directory'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
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
        reject(new Error(stderr.trim() || `Folder picker exited with code ${code}.`));
        return;
      }
      resolvePromise(stdout.trim() || null);
    });
  });
}

async function openDownloadDirectory(directory: string): Promise<void> {
  const resolved = resolve(directory);
  if (!existsSync(resolved)) {
    await mkdir(resolved, { recursive: true });
  }

  const command = process.platform === 'win32'
    ? 'explorer.exe'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [resolved], {
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
