import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';

const SECRET = 'test-secret';

function authedHeaders() {
  return { 'x-internal-auth': SECRET, 'content-type': 'application/json' };
}

describe('POST /tools/providers/seek/search', () => {
  it('rejects missing auth header', async () => {
    const app = buildServer(SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/tools/providers/seek/search',
      payload: { keywords: 'python' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('error');
    expect(res.json().error.type).toBe('unauthorized');
  });

  it('rejects bad request body', async () => {
    const app = buildServer(SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/tools/providers/seek/search',
      headers: authedHeaders(),
      payload: { wrong: 'shape' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('error');
    expect(body.error.type).toBe('bad_request');
  });

  // Live browser integration is covered by the dump:seek script and the
  // parseListing.test.ts fixture suite. Route-level auth + validation only here.
});
