import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { Prisma } from '@prisma/client';

/** Every API failure is returned as { error: { code, message } }. */
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500,
    public code: string,
    message: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const err = {
  badRequest: (message: string, code = 'BAD_REQUEST') => new AppError(400, code, message),
  unauthorized: (message = 'Authentication required', code = 'UNAUTHORIZED') => new AppError(401, code, message),
  forbidden: (message = 'You do not have access to this resource', code = 'FORBIDDEN') => new AppError(403, code, message),
  notFound: (message = 'Not found', code = 'NOT_FOUND') => new AppError(404, code, message),
  conflict: (message: string, code = 'CONFLICT') => new AppError(409, code, message),
  tooLarge: (message: string, code = 'PAYLOAD_TOO_LARGE') => new AppError(413, code, message),
  tooMany: (retryAfterSec: number, message = 'Too many attempts. Try again later.', code = 'RATE_LIMITED') =>
    new AppError(429, code, message, { 'Retry-After': String(retryAfterSec) }),
};

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function formatZodError(error: ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json(errorBody(e.code, e.message), { status: e.status, headers: e.headers });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(errorBody('VALIDATION_ERROR', formatZodError(e)), { status: 400 });
  }
  // Log only the error class and code. Messages from drivers can echo request values, which must never reach logs.
  const name = e instanceof Error ? e.name : 'UnknownError';
  const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
  console.error('Unhandled API error', { name, code });
  return NextResponse.json(errorBody('INTERNAL_ERROR', 'Something went wrong. Please try again.'), { status: 500 });
}

type RouteContext<P> = { params: Promise<P> };

/** Wraps a route handler so thrown AppErrors and zod errors become the standard error shape. */
export function route<P = Record<string, never>>(
  fn: (req: NextRequest, ctx: RouteContext<P>) => Promise<Response>,
): (req: NextRequest, ctx: RouteContext<P>) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

export async function parseJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw err.badRequest('Request body must be valid JSON', 'INVALID_JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', formatZodError(parsed.error));
  return parsed.data;
}

export function json<T>(data: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers });
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
