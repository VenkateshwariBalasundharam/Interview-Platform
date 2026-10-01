import { afterEach, describe, expect, it, vi } from 'vitest';
import { signSession, verifySession } from '@/lib/session';

const secret = 'a'.repeat(48);

afterEach(() => vi.useRealTimers());

describe('session tokens', () => {
  it('round-trips claims', async () => {
    const token = await signSession({ role: 'candidate', sub: 'c1', sid: 's1' }, 60, secret);
    expect(await verifySession(token, 'candidate', secret)).toEqual({ role: 'candidate', sub: 'c1', sid: 's1' });
  });

  it('rejects a token of the wrong role', async () => {
    const token = await signSession({ role: 'candidate', sub: 'c1', sid: 's1' }, 60, secret);
    expect(await verifySession(token, 'admin', secret)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession({ role: 'admin', sub: 'a1' }, 60, 'b'.repeat(48));
    expect(await verifySession(token, 'admin', secret)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signSession({ role: 'admin', sub: 'a1' }, 60, secret);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(await verifySession(token, 'admin', secret)).toBeNull();
  });

  it('rejects tampered and malformed tokens', async () => {
    const token = await signSession({ role: 'admin', sub: 'a1' }, 60, secret);
    const [h, p, s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ role: 'admin', sub: 'someone-else' })).toString('base64url')}.${s}`;
    expect(p).toBeTruthy();
    expect(await verifySession(forged, 'admin', secret)).toBeNull();
    expect(await verifySession('not.a.jwt', 'admin', secret)).toBeNull();
    expect(await verifySession(undefined, 'admin', secret)).toBeNull();
  });

  it('refuses to run with a short secret', async () => {
    await expect(signSession({ role: 'admin', sub: 'a1' }, 60, 'short')).rejects.toThrow(/JWT_SECRET/);
  });
});
