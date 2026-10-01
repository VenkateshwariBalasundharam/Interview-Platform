import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { err, parseJson, toErrorResponse } from '@/lib/http';

const body = async (res: Response) => res.json();

describe('error responses', () => {
  it('uses the { error: { code, message } } shape for app errors', async () => {
    const res = toErrorResponse(err.conflict('Already exists', 'DUPLICATE'));
    expect(res.status).toBe(409);
    expect(await body(res)).toEqual({ error: { code: 'DUPLICATE', message: 'Already exists' } });
  });

  it('maps each status helper correctly', () => {
    expect(toErrorResponse(err.badRequest('x')).status).toBe(400);
    expect(toErrorResponse(err.unauthorized()).status).toBe(401);
    expect(toErrorResponse(err.forbidden()).status).toBe(403);
    expect(toErrorResponse(err.notFound()).status).toBe(404);
    expect(toErrorResponse(err.tooMany(30)).status).toBe(429);
  });

  it('sets Retry-After on 429', () => {
    expect(toErrorResponse(err.tooMany(42)).headers.get('Retry-After')).toBe('42');
  });

  it('turns zod errors into a 400 VALIDATION_ERROR', async () => {
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: 'nope' });
    if (parsed.success) throw new Error('unreachable');
    const res = toErrorResponse(parsed.error);
    expect(res.status).toBe(400);
    expect((await body(res)).error.code).toBe('VALIDATION_ERROR');
  });

  it('hides internal error details and does not log the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = toErrorResponse(new Error('connection string postgres://user:secret@host'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await body(res))).not.toContain('secret');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret');
    spy.mockRestore();
  });
});

describe('parseJson', () => {
  const schema = z.object({ n: z.number() });
  const req = (text: string) => new Request('http://x', { method: 'POST', body: text });

  it('returns parsed data', async () => {
    expect(await parseJson(req('{"n":1}'), schema)).toEqual({ n: 1 });
  });
  it('rejects invalid JSON with INVALID_JSON', async () => {
    await expect(parseJson(req('{'), schema)).rejects.toMatchObject({ status: 400, code: 'INVALID_JSON' });
  });
  it('rejects schema violations with VALIDATION_ERROR', async () => {
    await expect(parseJson(req('{"n":"x"}'), schema)).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
