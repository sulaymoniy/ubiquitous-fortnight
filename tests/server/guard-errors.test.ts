import { ApiError, ValidationErrorDetails } from '@fortnight/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, login, type TestContext } from './helpers.ts';

let t: TestContext;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

// Routes from the contract that later tasks implement; the guard must already protect them.
const PROTECTED: [string, string][] = [
  ['GET', '/api/workspace'],
  ['PATCH', '/api/workspace'],
  ['GET', '/api/pages'],
  ['POST', '/api/pages'],
  ['GET', '/api/pages/abc'],
  ['POST', '/api/pages/abc/ops'],
  ['GET', '/api/search?q=x'],
  ['POST', '/api/uploads'],
  ['GET', '/api/databases'],
  ['POST', '/api/databases/abc/query'],
  ['PATCH', '/api/rows/abc'],
  ['GET', '/api/calendar/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z'],
  ['GET', '/api/changesets'],
  ['GET', '/api/agent/profiles'],
  ['POST', '/api/ai/inline'],
  ['GET', '/api/does-not-exist'],
  ['GET', '/api'],
];

describe('401 guard', () => {
  it.each(PROTECTED)('%s %s without a session is 401 unauthorized', async (method, url) => {
    const res = await t.app.inject({ method: method as 'GET', url });
    expect(res.statusCode).toBe(401);
    expect(ApiError.parse(res.json()).error.code).toBe('unauthorized');
  });

  it('with a session, unknown /api routes are 404 not_found', async () => {
    const cookie = await login(t.app);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/does-not-exist?token=secret',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).not.toContain('secret');
  });

  it('non-/api routes are not guarded', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/apiary' });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe('not_found');
  });

  it('health stays open but other methods on it are guarded', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: '/api/health' })).statusCode).toBe(401);
  });
});

describe('error shape', () => {
  it('validation errors list issues with paths', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { name: 42, password: 7 },
    });
    expect(res.statusCode).toBe(400);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe('validation_error');
    const details = ValidationErrorDetails.parse(body.error.details);
    expect(details.in).toBe('body');
    expect(details.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining([['name'], ['password']]),
    );
  });

  it('malformed JSON is a validation_error', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: '{"name":',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe('validation_error');
  });

  it('an oversized body is payload_too_large', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { name: 'x', password: 'y'.repeat(2 * 1024 * 1024) },
    });
    expect(res.statusCode).toBe(413);
    expect(ApiError.parse(res.json()).error.code).toBe('payload_too_large');
  });

  it('an unsupported content type is unsupported_media_type', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: 'name=x',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(415);
    expect(ApiError.parse(res.json()).error.code).toBe('unsupported_media_type');
  });
});
