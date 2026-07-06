import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(__dirname, '__tmp__');

beforeAll(async () => {
  try {
    await fs.mkdir(TEST_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }
});

afterEach(() => {
  // server.resetHandlers();
});

afterAll(async () => {
  // server.close();
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Directory may not exist
  }
});

export { TEST_DIR };
