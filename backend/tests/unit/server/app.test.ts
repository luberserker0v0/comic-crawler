import { describe, it, expect } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(__dirname, '../../../src/server');

describe('Server', () => {
  ServerTestGroup1();
});

function ServerTestGroup1(): void {
  it('should have app.ts', ServerTestShouldHaveAppTs);
  it('should have routes directory', ServerTestShouldHaveRoutesDirectory);
  it('should have websocket.ts', ServerTestShouldHaveWebsocketTs);
  it('should have middleware directory', ServerTestShouldHaveMiddlewareDirectory);
  it('should have index.ts', ServerTestShouldHaveIndexTs);
}

async function ServerTestShouldHaveAppTs() {
    const exists = await fs.access(join(srcDir, 'app.ts')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
}

async function ServerTestShouldHaveRoutesDirectory() {
    const routesDir = join(srcDir, 'routes');
    const files = await fs.readdir(routesDir);
    expect(files).toContain('tasks.ts');
    expect(files).toContain('config.ts');
    expect(files).toContain('adapters.ts');
    expect(files).toContain('search.ts');
    expect(files).toContain('agent.ts');
}

async function ServerTestShouldHaveWebsocketTs() {
    const exists = await fs.access(join(srcDir, 'websocket.ts')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
}

async function ServerTestShouldHaveMiddlewareDirectory() {
    const middlewareDir = join(srcDir, 'middleware');
    const files = await fs.readdir(middlewareDir);
    expect(files).toContain('cors.ts');
    expect(files).toContain('api-security.ts');
}

async function ServerTestShouldHaveIndexTs() {
    const exists = await fs.access(join(srcDir, 'index.ts')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
}
