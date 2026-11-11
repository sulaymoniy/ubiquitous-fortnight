import { SEED_IDS } from '@fortnight/server';
import {
  ApiError,
  ArchivePageResponse,
  CreatePageResponse,
  MAX_UPLOAD_BYTES,
  PageOpsResponse,
  SearchResponse,
  UpdatePageResponse,
  UploadResponse,
} from '@fortnight/shared';
import { v7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { client } from './api-helpers.ts';
import { createTestApp, login, type TestContext } from './helpers.ts';

let t: TestContext;
let cookie: string;
let api: ReturnType<typeof client>;
beforeEach(async () => {
  t = await createTestApp({ seed: true });
  cookie = await login(t.app);
  api = client(t.app, cookie);
});
afterEach(async () => {
  await t.close();
});

const search = (q: string, limit?: number) =>
  api.ok(
    SearchResponse,
    'GET',
    `/api/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`,
  );

describe('search', () => {
  it('finds a word right after it is saved, with a snippet and the block id', async () => {
    const page = await api.ok(CreatePageResponse, 'POST', '/api/pages', { title: 'Notes' });
    const blockId = v7();
    expect((await search('zephyrine')).results).toEqual([]);
    await api.ok(PageOpsResponse, 'POST', `/api/pages/${page.id}/ops`, {
      ops: [
        {
          op: 'insert',
          block: {
            id: blockId,
            parentId: null,
            position: 'a0',
            type: 'paragraph',
            content: { rich: [{ text: 'The zephyrine wind arrives at dawn.' }] },
          },
        },
      ],
    });
    const { results } = await search('zephyrine');
    expect(results).toEqual([
      {
        kind: 'page',
        id: page.id,
        pageId: page.id,
        databaseId: null,
        title: 'Notes',
        snippet: expect.stringContaining('zephyrine'),
        blockId,
      },
    ]);
  });

  it('ranks title matches before body matches', async () => {
    const body = await api.ok(CreatePageResponse, 'POST', '/api/pages', { title: 'Misc' });
    await api.ok(PageOpsResponse, 'POST', `/api/pages/${body.id}/ops`, {
      ops: [
        {
          op: 'insert',
          block: {
            id: v7(),
            parentId: null,
            position: 'a0',
            type: 'paragraph',
            content: { rich: [{ text: 'quokka quokka quokka quokka' }] },
          },
        },
      ],
    });
    const titled = await api.ok(CreatePageResponse, 'POST', '/api/pages', {
      title: 'Quokka facts',
    });
    const { results } = await search('quokka');
    expect(results.map((r) => r.id)).toEqual([titled.id, body.id]);
    expect(results[0]?.blockId).toBeNull();
    expect(results[0]?.snippet).toContain('Quokka');
  });

  it('matches prefixes, ignores accents and case, and needs every word', async () => {
    await api.ok(CreatePageResponse, 'POST', '/api/pages', { title: 'Café Planning' });
    expect((await search('cafe')).results.map((r) => r.title)).toEqual(['Café Planning']);
    expect((await search('PLAN')).results.map((r) => r.title)).toContain('Café Planning');
    expect((await search('cafe banana')).results).toEqual([]);
    expect((await search('"*)(')).results).toEqual([]); // FTS syntax is neutralized
  });

  it('follows renames and archives', async () => {
    const page = await api.ok(CreatePageResponse, 'POST', '/api/pages', { title: 'Alpha' });
    await api.ok(UpdatePageResponse, 'PATCH', `/api/pages/${page.id}`, {
      version: 0,
      title: 'Beta',
    });
    expect((await search('alpha')).results).toEqual([]);
    expect((await search('beta')).results.map((r) => r.id)).toEqual([page.id]);
    await api.ok(ArchivePageResponse, 'POST', `/api/pages/${page.id}/archive`);
    expect((await search('beta')).results).toEqual([]);
    await api.ok(ArchivePageResponse, 'POST', `/api/pages/${page.id}/restore`);
    expect((await search('beta')).results.map((r) => r.id)).toEqual([page.id]);
  });

  it('finds seeded pages and database rows', async () => {
    const welcome = await search('welcome');
    expect(welcome.results.map((r) => r.id)).toContain(SEED_IDS.gettingStarted);
    const row = (await search('weekly review')).results[0];
    expect(row).toMatchObject({
      kind: 'row',
      id: SEED_IDS.rowWeeklyReview,
      pageId: SEED_IDS.rowWeeklyReview,
      databaseId: SEED_IDS.calendarDb,
      blockId: null,
    });
  });

  it('respects the limit and validates the query', async () => {
    for (let i = 0; i < 4; i++) {
      await api.ok(CreatePageResponse, 'POST', '/api/pages', { title: `Limit test ${i}` });
    }
    expect((await search('limit test', 2)).results).toHaveLength(2);
    expect((await api.call('GET', '/api/search?q=')).status).toBe(400);
    expect((await api.call('GET', '/api/search?q=x&limit=500')).status).toBe(400);
  });
});

/** Builds a multipart/form-data body by hand. */
function multipart(field: string, filename: string, type: string, data: Buffer) {
  const boundary = '----fortnight' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('uploads', () => {
  const upload = (field: string, name: string, type: string, data: Buffer, withCookie = true) => {
    const body = multipart(field, name, type, data);
    return t.app.inject({
      method: 'POST',
      url: '/api/uploads',
      payload: body.payload,
      headers: { ...body.headers, ...(withCookie ? { cookie } : {}) },
    });
  };

  it('stores an image and serves the same bytes back', async () => {
    const res = await upload('file', 'dot.png', 'image/png', PNG);
    expect(res.statusCode).toBe(200);
    const { id, url } = UploadResponse.parse(res.json());
    expect(url).toBe(`/uploads/${id}`);
    const got = await t.app.inject({ method: 'GET', url, headers: { cookie } });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.rawPayload.equals(PNG)).toBe(true);
  });

  it('detects the type from the bytes, not the client header', async () => {
    const res = await upload('file', 'dot.bin', 'application/octet-stream', PNG);
    expect(res.statusCode).toBe(200);
    const fakePng = await upload('file', 'evil.png', 'image/png', Buffer.from('<svg onload=x>'));
    expect(fakePng.statusCode).toBe(415);
    expect(ApiError.parse(fakePng.json()).error.code).toBe('unsupported_media_type');
  });

  it('accepts JPEG, GIF and WebP signatures', async () => {
    const samples = [
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
      Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'),
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]),
    ];
    for (const s of samples) expect((await upload('file', 'x', 'image/x', s)).statusCode).toBe(200);
  });

  it('rejects files over 10 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]);
    const res = await upload('file', 'big.png', 'image/png', big);
    expect(res.statusCode).toBe(413);
    expect(ApiError.parse(res.json()).error.code).toBe('payload_too_large');
  });

  it('needs the "file" field, multipart, and a session', async () => {
    expect((await upload('picture', 'dot.png', 'image/png', PNG)).statusCode).toBe(400);
    const json = await api.call('POST', '/api/uploads', { file: 'x' });
    expect(json.status).toBe(415);
    expect((await upload('file', 'dot.png', 'image/png', PNG, false)).statusCode).toBe(401);
    const res = await upload('file', 'dot.png', 'image/png', PNG);
    const { url } = UploadResponse.parse(res.json());
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });

  it('404s unknown uploads and rejects malformed ids', async () => {
    const missing = await t.app.inject({
      method: 'GET',
      url: `/uploads/${v7()}`,
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
    const bad = await t.app.inject({
      method: 'GET',
      url: '/uploads/..%2F..%2Fpackage.json',
      headers: { cookie },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('serves the seeded image', async () => {
    const got = await t.app.inject({
      method: 'GET',
      url: `/uploads/${SEED_IDS.upload}`,
      headers: { cookie },
    });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(PNG)).toBe(true);
  });
});
