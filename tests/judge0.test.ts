import { describe, expect, it } from 'vitest';
import { executeAll, type RunnerConfig } from '@/lib/judge0';

const config: RunnerConfig = { url: 'http://judge0.test' };
const b64 = (s: string) => Buffer.from(s).toString('base64');
const noSleep = async () => {};
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
const bad = () => ({ ok: false, json: async () => ({}) }) as unknown as Response;

describe('executeAll', () => {
  it('sends base64 source and stdin, never an expected output, and returns results in input order', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return ok([{ token: 'a' }, { token: 'b' }]);
      // Poll answers in reverse order on purpose: the client must reorder by token.
      return ok({ submissions: [{ token: 'b', status_id: 3, stdout: b64('2\n'), time: '0.01', memory: 100 }, { token: 'a', status_id: 3, stdout: b64('1\n'), time: '0.02', memory: 200 }] });
    }) as unknown as typeof fetch;

    const results = await executeAll({ language: 'python', code: 'print(1)', inputs: ['x', 'y'], timeLimitSec: 2 }, { config, fetchImpl, sleep: noSleep });
    expect(results.map((r) => r.stdout)).toEqual(['1\n', '2\n']);
    expect(results[0].timeSec).toBe(0.02);

    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.submissions).toHaveLength(2);
    expect(sent.submissions[0].language_id).toBe(71);
    expect(Buffer.from(sent.submissions[0].source_code, 'base64').toString()).toBe('print(1)');
    expect(Buffer.from(sent.submissions[1].stdin, 'base64').toString()).toBe('y');
    expect(JSON.stringify(sent)).not.toContain('expected_output');
    expect(calls[0].url).toContain('base64_encoded=true');
  });

  it('keeps polling while any test is still queued or processing', async () => {
    let polls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return ok([{ token: 't' }]);
      polls++;
      return ok({ submissions: [{ token: 't', status_id: polls < 3 ? 2 : 3, stdout: b64('ok') }] });
    }) as unknown as typeof fetch;
    const [r] = await executeAll({ language: 'python', code: '', inputs: [''], timeLimitSec: 1 }, { config, fetchImpl, sleep: noSleep });
    expect(polls).toBe(3);
    expect(r.statusId).toBe(3);
  });

  it('splits more than 20 inputs into several batches and keeps the order', async () => {
    let posts = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts++;
        const n = JSON.parse(String(init.body)).submissions.length;
        return ok(Array.from({ length: n }, (_, i) => ({ token: `p${posts}-${i}` })));
      }
      const tokens = new URL(url).searchParams.get('tokens')!.split(',');
      return ok({ submissions: tokens.map((t) => ({ token: t, status_id: 3, stdout: b64(t) })) });
    }) as unknown as typeof fetch;
    const results = await executeAll({ language: 'python', code: '', inputs: Array.from({ length: 25 }, () => ''), timeLimitSec: 1 }, { config, fetchImpl, sleep: noSleep });
    expect(posts).toBe(2);
    expect(results).toHaveLength(25);
    expect(results[0].stdout).toBe('p1-0');
    expect(results[24].stdout).toBe('p2-4');
  });

  it('uses RapidAPI headers when a host is set, and X-Auth-Token when only a key is set', async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      return init?.method === 'POST' ? ok([{ token: 't' }]) : ok({ submissions: [{ token: 't', status_id: 3 }] });
    }) as unknown as typeof fetch;
    await executeAll({ language: 'python', code: '', inputs: [''], timeLimitSec: 1 }, { config: { url: 'http://x', apiKey: 'k', apiHost: 'h' }, fetchImpl, sleep: noSleep });
    expect(seen[0]['X-RapidAPI-Key']).toBe('k');
    expect(seen[0]['X-RapidAPI-Host']).toBe('h');
    seen.length = 0;
    await executeAll({ language: 'python', code: '', inputs: [''], timeLimitSec: 1 }, { config: { url: 'http://x', apiKey: 'k' }, fetchImpl, sleep: noSleep });
    expect(seen[0]['X-Auth-Token']).toBe('k');
    expect(seen[0]['X-RapidAPI-Key']).toBeUndefined();
  });

  it('honours a language id override', async () => {
    let sent: { submissions: { language_id: number }[] } | null = null;
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') { sent = JSON.parse(String(init.body)); return ok([{ token: 't' }]); }
      return ok({ submissions: [{ token: 't', status_id: 3 }] });
    }) as unknown as typeof fetch;
    await executeAll({ language: 'python', code: '', inputs: [''], timeLimitSec: 1 }, { config: { url: 'http://x', languageIds: { python: 100 } }, fetchImpl, sleep: noSleep });
    expect(sent!.submissions[0].language_id).toBe(100);
  });

  it('turns a failing or unreachable runner into a friendly, retryable error', async () => {
    const down = (async () => bad()) as unknown as typeof fetch;
    await expect(executeAll({ language: 'python', code: '', inputs: [''], timeLimitSec: 1 }, { config, fetchImpl: down, sleep: noSleep })).rejects.toMatchObject({ code: 'RUNNER_UNAVAILABLE' });
    const boom = (async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:2358'); }) as unknown as typeof fetch;
    await expect(executeAll({ language: 'python', code: '', inputs: [''], timeLimitSec: 1 }, { config, fetchImpl: boom, sleep: noSleep })).rejects.toMatchObject({ code: 'RUNNER_UNAVAILABLE' });
  });

  it('gives up with RUNNER_TIMEOUT if tests never finish', async () => {
    const fetchImpl = (async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? ok([{ token: 't' }]) : ok({ submissions: [{ token: 't', status_id: 2 }] }))) as unknown as typeof fetch;
    await expect(executeAll({ language: 'python', code: '', inputs: [''], timeLimitSec: 1 }, { config, fetchImpl, sleep: noSleep })).rejects.toMatchObject({ code: 'RUNNER_TIMEOUT' });
  });
});
