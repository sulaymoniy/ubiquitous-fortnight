import { ApiError, CONTRACT_VERSION, HealthResponse, SessionResponse } from '@fortnight/shared';
import { mockUserFromName } from '@fortnight/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, login, type TestContext } from './helpers.ts';

let t: TestContext;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('GET /api/health', () => {
  it('answers without a session', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponse.parse(res.json());
    expect(body).toEqual({
      ok: true,
      contractVersion: CONTRACT_VERSION,
      agentKeyConfigured: false,
    });
  });

  it('reports a configured key without revealing it', async () => {
    const withKey = await createTestApp({ apiKey: 'sk-ant-test-health' });
    try {
      const res = await withKey.app.inject({ method: 'GET', url: '/api/health' });
      expect(HealthResponse.parse(res.json()).agentKeyConfigured).toBe(true);
      expect(res.body).not.toContain('sk-ant-test-health');
    } finally {
      await withKey.close();
    }
  });
});

describe('mock login', () => {
  it('accepts any name and password and sets an HttpOnly fsid cookie', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { name: '  Grace   Hopper ', password: 'anything at all' },
    });
    expect(res.statusCode).toBe(200);
    const { user } = SessionResponse.parse(res.json());
    expect(user).toEqual(mockUserFromName('Grace Hopper'));
    expect(user.name).toBe('Grace Hopper');
    expect(user.initials).toBe('GH');
    const cookie = res.cookies.find((c) => c.name === 'fsid');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.path).toBe('/');
  });

  it('accepts a login without a password', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/session', payload: { name: 'x' } });
    expect(res.statusCode).toBe(200);
  });

  it('derives the same user from the same name', () => {
    const a = mockUserFromName('ada lovelace');
    const b = mockUserFromName('Ada  Lovelace');
    expect({ ...a, name: undefined }).toEqual({ ...b, name: undefined });
    expect(b.name).toBe('Ada Lovelace');
    expect(mockUserFromName('Ada').id).not.toBe(mockUserFromName('Grace').id);
    expect(mockUserFromName('Ada').initials).toBe('A');
  });

  it('rejects an empty or missing name with validation_error', async () => {
    for (const payload of [{ name: '   ' }, {}, { name: 'x'.repeat(81) }]) {
      const res = await t.app.inject({ method: 'POST', url: '/api/session', payload });
      expect(res.statusCode).toBe(400);
      expect(ApiError.parse(res.json()).error.code).toBe('validation_error');
    }
  });

  it('GET /api/session returns the user with the cookie and 401 without', async () => {
    const cookie = await login(t.app, 'Ada Lovelace');
    const me = await t.app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(SessionResponse.parse(me.json()).user.name).toBe('Ada Lovelace');

    const anon = await t.app.inject({ method: 'GET', url: '/api/session' });
    expect(anon.statusCode).toBe(401);
    expect(ApiError.parse(anon.json()).error.code).toBe('unauthorized');
  });

  it('logout ends the session and clears the cookie', async () => {
    const cookie = await login(t.app);
    const out = await t.app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(out.json()).toEqual({});
    const cleared = out.cookies.find((c) => c.name === 'fsid');
    expect(cleared?.value).toBe('');

    const after = await t.app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('logout without a session still answers {}', async () => {
    const res = await t.app.inject({ method: 'DELETE', url: '/api/session' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('logging in again replaces the old session', async () => {
    const first = await login(t.app, 'One');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { name: 'Two' },
      headers: { cookie: first },
    });
    expect(res.statusCode).toBe(200);
    const old = await t.app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: first },
    });
    expect(old.statusCode).toBe(401);
  });

  it('a forged cookie is not a session', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: 'fsid=forged' },
    });
    expect(res.statusCode).toBe(401);
  });
});
