import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';

describe('tools service', () => {
  it('health endpoint returns ok envelope without auth', async () => {
    const app = buildServer('test-secret');
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; data: { service: string } };
    expect(body.status).toBe('ok');
    expect(body.data.service).toBe('tools');
    await app.close();
  });

  it('rejects requests without valid X-Internal-Auth header', async () => {
    const app = buildServer('test-secret');
    const response = await app.inject({ method: 'GET', url: '/tools/ping' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; error: { type: string } };
    expect(body.status).toBe('error');
    expect(body.error.type).toBe('unauthorized');
    await app.close();
  });
});
