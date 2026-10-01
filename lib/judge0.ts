// Judge0 client (server only). Runs one program against several inputs and returns raw results.
// The expected output never goes to Judge0: lib/coding.ts compares it, so hidden answers stay on this server.
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/http';
import { CODING_LANGUAGES, type CodingLanguageId } from '@/lib/coding';

export interface RunnerConfig {
  url: string;
  apiKey?: string;
  apiHost?: string;
  languageIds?: Partial<Record<CodingLanguageId, number>>;
}

export interface RunResult {
  statusId: number;
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  message: string | null;
  timeSec: number | null;
  memoryKb: number | null;
}

const BATCH_SIZE = 20; // Judge0's default MAX_SUBMISSION_BATCH_SIZE
const POLL_DELAYS_MS = [400, 600, 800, 1000, 1200, 1500, 2000, 2000, 2500, 2500, 3000, 3000, 3000, 3000, 3000, 3000];
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const unb64 = (text: string | null | undefined) => (text == null ? null : Buffer.from(text, 'base64').toString('utf8'));

const unavailable = () =>
  new AppError(500, 'RUNNER_UNAVAILABLE', 'The code runner is not available right now. Your code is saved. Please try again in a moment.');

export function runnerConfigFromEnv(): RunnerConfig {
  const env = getEnv();
  if (!env.JUDGE0_URL) throw new AppError(500, 'RUNNER_NOT_CONFIGURED', 'The code runner is not set up yet. Please contact the hiring team.');
  let languageIds: RunnerConfig['languageIds'];
  if (env.JUDGE0_LANGUAGE_IDS) {
    try {
      languageIds = JSON.parse(env.JUDGE0_LANGUAGE_IDS) as RunnerConfig['languageIds'];
    } catch {
      throw new Error('JUDGE0_LANGUAGE_IDS must be valid JSON, for example {"python":100}');
    }
  }
  return { url: env.JUDGE0_URL.replace(/\/+$/, ''), apiKey: env.JUDGE0_API_KEY, apiHost: env.JUDGE0_API_HOST, languageIds };
}

function headers(config: RunnerConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey && config.apiHost) {
    h['X-RapidAPI-Key'] = config.apiKey; // RapidAPI-hosted Judge0
    h['X-RapidAPI-Host'] = config.apiHost;
  } else if (config.apiKey) {
    h['X-Auth-Token'] = config.apiKey; // self-hosted with AUTHN_HEADER configured
  }
  return h;
}

interface RawResult {
  token?: string;
  status_id?: number;
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null;
  memory?: number | null;
}

export interface ExecuteInput {
  language: CodingLanguageId;
  code: string;
  inputs: string[];
  timeLimitSec: number;
}

type Fetch = typeof fetch;

/** Runs `code` once per input. Results come back in the same order as `inputs`. */
export async function executeAll(
  input: ExecuteInput,
  deps: { config?: RunnerConfig; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RunResult[]> {
  const config = deps.config ?? runnerConfigFromEnv();
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const language = CODING_LANGUAGES.find((l) => l.id === input.language);
  if (!language) throw new Error(`Unknown language: ${input.language}`);
  const languageId = config.languageIds?.[input.language] ?? language.judge0Id;
  const cpu = Math.min(Math.max(input.timeLimitSec, 0.5), 10);

  const out: RunResult[] = [];
  for (let i = 0; i < input.inputs.length; i += BATCH_SIZE) {
    const chunk = input.inputs.slice(i, i + BATCH_SIZE);
    out.push(...(await runChunk(chunk, { languageId, code: input.code, cpu }, config, doFetch, sleep)));
  }
  return out;
}

async function runChunk(
  inputs: string[],
  job: { languageId: number; code: string; cpu: number },
  config: RunnerConfig,
  doFetch: Fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<RunResult[]> {
  let tokens: string[];
  try {
    const res = await doFetch(`${config.url}/submissions/batch?base64_encoded=true`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({
        submissions: inputs.map((stdin) => ({
          language_id: job.languageId,
          source_code: b64(job.code),
          stdin: b64(stdin),
          cpu_time_limit: job.cpu,
          wall_time_limit: Math.min(20, job.cpu * 4 + 2),
        })),
      }),
    });
    if (!res.ok) throw unavailable();
    const created = (await res.json()) as { token?: string }[];
    if (!Array.isArray(created) || created.length !== inputs.length || created.some((c) => !c.token)) throw unavailable();
    tokens = created.map((c) => c.token as string);
  } catch (e) {
    throw e instanceof AppError ? e : unavailable();
  }

  const fields = 'token,status_id,stdout,stderr,compile_output,message,time,memory';
  for (const delay of POLL_DELAYS_MS) {
    await sleep(delay);
    let rows: RawResult[];
    try {
      const res = await doFetch(`${config.url}/submissions/batch?base64_encoded=true&fields=${fields}&tokens=${tokens.join(',')}`, { headers: headers(config) });
      if (!res.ok) throw unavailable();
      rows = ((await res.json()) as { submissions?: RawResult[] }).submissions ?? [];
    } catch (e) {
      throw e instanceof AppError ? e : unavailable();
    }
    const byToken = new Map(rows.map((r) => [r.token, r]));
    const ordered = tokens.map((t) => byToken.get(t));
    if (ordered.every((r) => r && r.status_id !== undefined && r.status_id > 2)) {
      return ordered.map((r) => toResult(r as RawResult));
    }
  }
  throw new AppError(500, 'RUNNER_TIMEOUT', 'The code runner took too long to answer. Your code is saved. Please try again.');
}

function toResult(r: RawResult): RunResult {
  return {
    statusId: r.status_id ?? 13,
    stdout: unb64(r.stdout),
    stderr: unb64(r.stderr),
    compileOutput: unb64(r.compile_output),
    message: unb64(r.message),
    timeSec: r.time != null ? Number(r.time) : null,
    memoryKb: r.memory ?? null,
  };
}
