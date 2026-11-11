// Every response the server implements so far parses with the shared schemas.
import {
  ApiError,
  HealthResponse,
  LogoutResponse,
  SessionResponse,
  ValidationErrorDetails,
} from '@fortnight/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, login, type TestContext } from '../server/helpers.ts';

let t: TestContext;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('implemented responses match the contract', () => {
  it('GET /api/health → HealthResponse', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(HealthResponse.safeParse(res.json()).success).toBe(true);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('POST /api/session → SessionResponse', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/session', payload: { name: 'A' } });
    expect(SessionResponse.safeParse(res.json()).success).toBe(true);
  });

  it('GET /api/session → SessionResponse', async () => {
    const cookie = await login(t.app);
    const res = await t.app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    expect(SessionResponse.safeParse(res.json()).success).toBe(true);
  });

  it('DELETE /api/session → LogoutResponse', async () => {
    const res = await t.app.inject({ method: 'DELETE', url: '/api/session' });
    expect(LogoutResponse.safeParse(res.json()).success).toBe(true);
  });

  it('401, 404, 400, 413 and 415 → ApiError', async () => {
    const cookie = await login(t.app);
    const cases = [
      { method: 'GET' as const, url: '/api/session' },
      { method: 'GET' as const, url: '/api/missing', headers: { cookie } },
      { method: 'POST' as const, url: '/api/session', payload: { name: '' } },
      { method: 'POST' as const, url: '/api/session', payload: { name: 'x'.repeat(1_100_000) } },
      {
        method: 'POST' as const,
        url: '/api/session',
        payload: 'x',
        headers: { 'content-type': 'text/plain' }, // removed parser: JSON only
      },
    ];
    const statuses: number[] = [];
    for (const c of cases) {
      const res = await t.app.inject(c);
      statuses.push(res.statusCode);
      const body = ApiError.parse(res.json());
      if (body.error.code === 'validation_error') {
        expect(ValidationErrorDetails.safeParse(body.error.details).success).toBe(true);
      }
    }
    expect(statuses).toEqual([401, 404, 400, 413, 415]);
  });
});
