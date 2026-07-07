import { describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { HappyMhAdapter } from '../../../src/adapter/sites/happymh';
import { setupAdaptersRoutes } from '../../../src/server/routes/adapters';

describe('Adapter routes', () => {
  it('resolves HappyMH as a full adapter for manga catalog URLs', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new HappyMhAdapter());
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/resolve',
      payload: {
        url: 'https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu',
        mode: 'all',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      status: 'matched',
      discoveryTarget: 'full',
      adapter: {
        id: 'happymh',
        capabilities: { verification: true, metadata: true, chapterImages: true },
      },
    });

    await app.close();
  });

  it('resolves HappyMH for specific chapter URLs', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new HappyMhAdapter());
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/resolve',
      payload: {
        url: 'https://m.happymh.com/mangaread/wozaixingjiguojiadangedelingzhu/3279871',
        mode: 'chapters',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('matched');
    expect(response.json().data.adapter.id).toBe('happymh');

    await app.close();
  });
});
