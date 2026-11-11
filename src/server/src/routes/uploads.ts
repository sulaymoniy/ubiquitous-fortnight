import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, UploadResponse } from '@fortnight/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { uploads } from '../db/schema.ts';
import { AppError } from '../http/errors.ts';
import { newId, nowIso } from '../ids.ts';

type ImageType = (typeof ALLOWED_UPLOAD_TYPES)[number];

/** Detects the image type from the file's first bytes; the client's content type is ignored. */
export function sniffImageType(buf: Buffer): ImageType | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const UploadIdParams = z.object({ id: z.uuid() });

/**
 * POST /api/uploads (multipart field `file`, image only, max 10 MB) and GET /uploads/:id.
 * Uploads are not workspace edits, so they write no changeset. `/uploads` needs a session, like
 * `/api` (the browser sends the cookie with same-origin image requests).
 */
export function uploadRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  const { db, config } = ctx;
  return async (app) => {
    app.post('/api/uploads', { schema: { response: { 200: UploadResponse } } }, async (request) => {
      if (!request.isMultipart()) {
        throw new AppError(415, 'unsupported_media_type', 'Send the image as multipart/form-data');
      }
      const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
      if (!file || file.fieldname !== 'file') {
        throw new AppError(400, 'validation_error', 'Missing form field "file"', {
          in: 'body',
          issues: [{ path: ['file'], message: 'required' }],
        });
      }
      const data = await file.toBuffer(); // throws 413 above MAX_UPLOAD_BYTES
      const type = sniffImageType(data);
      if (!type) {
        throw new AppError(415, 'unsupported_media_type', 'Only PNG, JPEG, GIF and WebP images');
      }
      const id = newId();
      mkdirSync(config.uploadsDir, { recursive: true });
      writeFileSync(path.join(config.uploadsDir, id), data);
      db.insert(uploads)
        .values({
          id,
          fileName: path.basename(file.filename || 'image').slice(0, 255),
          mimeType: type,
          size: data.length,
          createdAt: nowIso(),
        })
        .run();
      return { id, url: `/uploads/${id}` };
    });

    app.get('/uploads/:id', { schema: { params: UploadIdParams } }, async (request, reply) => {
      const [row] = db.select().from(uploads).where(eq(uploads.id, request.params.id)).all();
      const file = row && path.join(config.uploadsDir, row.id);
      if (!row || !file || !existsSync(file)) {
        throw new AppError(404, 'not_found', 'Upload not found');
      }
      return reply
        .header('content-type', row.mimeType)
        .header('content-length', row.size)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(createReadStream(file));
    });
  };
}
