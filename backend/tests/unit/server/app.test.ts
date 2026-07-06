import { describe, it, expect } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

describe('Server', () => {
  const srcDir = join(__dirname, '../../../src/server');

  it('should have app.ts', async () => {
    const exists = await fs.access(join(srcDir, 'app.ts')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('should have routes directory', async () => {
    const routesDir = join(srcDir, 'routes');
    const files = await fs.readdir(routesDir);
    expect(files).toContain('tasks.ts');
    expect(files).toContain('config.ts');
    expect(files).toContain('adapters.ts');
    expect(files).toContain('search.ts');
    expect(files).toContain('agent.ts');
  });

  it('should have websocket.ts', async () => {
    const exists = await fs.access(join(srcDir, 'websocket.ts')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('should have middleware directory', async () => {
    const middlewareDir = join(srcDir, 'middleware');
    const files = await fs.readdir(middlewareDir);
    expect(files).toContain('cors.ts');
    expect(files).toContain('auth.ts');
  });

  it('should have index.ts', async () => {
    const exists = await fs.access(join(srcDir, 'index.ts')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
