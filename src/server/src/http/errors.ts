import type { ApiError, ErrorCode, ValidationErrorDetails } from '@fortnight/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/** Throw from a route to send a contract-shaped error. */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorBody(code: ErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

const CONTEXT: Record<string, ValidationErrorDetails['in']> = {
  body: 'body',
  params: 'params',
  querystring: 'query',
  headers: 'headers',
};

function toPath(instancePath: string): (string | number)[] {
  return instancePath
    .split('/')
    .filter((s) => s !== '')
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

/** Maps every error to `{ error: { code, message, details? } }` without leaking internals. */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.status(error.status).send(errorBody(error.code, error.message, error.details));
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const details: ValidationErrorDetails = {
      in: CONTEXT[error.validationContext ?? 'body'] ?? 'body',
      issues: error.validation.map((v) => ({
        path: toPath(v.instancePath),
        message: v.message ?? 'invalid value',
      })),
    };
    return reply.status(400).send(errorBody('validation_error', 'Request is invalid', details));
  }
  const status = error.statusCode ?? 500;
  if (status === 413) {
    return reply.status(413).send(errorBody('payload_too_large', 'Request body is too large'));
  }
  if (status === 415) {
    return reply.status(415).send(errorBody('unsupported_media_type', 'Unsupported content type'));
  }
  if (status >= 400 && status < 500) {
    // Fastify's own client errors, e.g. malformed or empty JSON body.
    const details: ValidationErrorDetails = {
      in: 'body',
      issues: [{ path: [], message: error.message }],
    };
    return reply.status(400).send(errorBody('validation_error', 'Request is invalid', details));
  }
  request.log.error({ err: error }, 'request failed');
  return reply.status(500).send(errorBody('internal_error', 'Internal server error'));
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  const pathOnly = request.url.split('?')[0] ?? request.url;
  return reply
    .status(404)
    .send(errorBody('not_found', `Route ${request.method} ${pathOnly} not found`));
}
