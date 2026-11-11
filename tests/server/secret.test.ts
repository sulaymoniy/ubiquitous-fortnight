import { readConfig } from '@fortnight/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, login, type TestContext } from './helpers.ts';

const KEY = 'sk-ant-api03-TEST-SENTINEL-never-leak-0123456789';

let t: TestContext;
beforeEach(async () => {
  t = await createTestApp({ apiKey: KEY, seed: true });
});
afterEach(async () => {
  await t.close();
});

describe('API key handling', () => {
  it('never appears in any response body or header', async () => {
    const cookie = await login(t.app);
    const requests: { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: object }[] = [
      { method: 'GET', url: '/api/health' },
      { method: 'POST', url: '/api/session', payload: { name: 'Key Tester' } },
      { method: 'POST', url: '/api/session', payload: { name: '' } },
      { method: 'GET', url: '/api/session' },
      { method: 'GET', url: '/api/workspace' },
      { method: 'GET', url: '/api/agent/profiles' },
      { method: 'GET', url: '/api/agent/conversations' },
      { method: 'GET', url: '/api/nope' },
      { method: 'DELETE', url: '/api/session' },
    ];
    for (const withCookie of [true, false]) {
      for (const r of requests) {
        const res = await t.app.inject({
          ...r,
          headers: withCookie ? { cookie } : {},
        });
        expect(res.body).not.toContain(KEY);
        expect(JSON.stringify(res.headers)).not.toContain(KEY);
      }
    }
  });

  it('is not stored in the server config', () => {
    expect(JSON.stringify(t.config)).not.toContain(KEY);
    expect(readConfig({ ANTHROPIC_API_KEY: '   ' }).agentKeyConfigured).toBe(false);
  });
});
