import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, unauthorizedEvent } from '../../src/web/src/api/client';

afterEach(() => vi.unstubAllGlobals());
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
describe('shared API contract', () => {
  it('rejects a successful response with an invalid shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true })));
    await expect(api.health()).rejects.toMatchObject({
      status: 502,
      code: 'invalid_response',
    });
  });
  it('rejects malformed JSON without exposing response contents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>internal details</html>')),
    );
    await expect(api.session()).rejects.toThrow(
      'The workspace sent an unexpected response. Refresh and try again.',
    );
  });
  it('keeps structured API error details for conflict handling', async () => {
    const details = { conflicts: [{ entity: 'page', id: 'page-1' }] };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'undo_conflict',
              message: 'A later change prevents undo.',
              details,
            },
          },
          409,
        ),
      ),
    );
    await expect(api.session()).rejects.toMatchObject({
      status: 409,
      code: 'undo_conflict',
      details,
    });
  });
  it('notifies session expiry even if a 401 response is not JSON', async () => {
    const listener = vi.fn();
    window.addEventListener(unauthorizedEvent, listener);
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('expired', { status: 401 })));
      await expect(api.session()).rejects.toBeInstanceOf(ApiError);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(unauthorizedEvent, listener);
    }
  });
  it('turns a network failure into an actionable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(api.health()).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      message: 'Could not connect to your workspace. Check your connection and try again.',
    });
  });
  it('preserves cancellation instead of reporting a connection error', async () => {
    const error = new DOMException('Cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(api.session()).rejects.toBe(error);
  });
});
