// Minimal LLM client (server only). Uses fetch, so no extra dependency is needed.
// Default provider is Google Gemini; Anthropic Claude is still supported via LLM_PROVIDER="anthropic".
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/http';

export interface CompleteArgs {
  system: string;
  user: string;
  maxTokens: number;
  /** Lower is more consistent (grading uses 0.2). Omitted = the provider default (Gemini calls use 0.8). */
  temperature?: number;
}

/** Sends one prompt and returns the reply text. Injectable so generation can be tested without the network. */
export type Complete = (args: CompleteArgs) => Promise<string>;

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

const TIMEOUT_MS = 90_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 3;
// Gemini's free tier has low per-minute limits, so only a couple of calls run at once.
const GEMINI_CONCURRENCY = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── tiny concurrency limiter ──
let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(limit: number, fn: () => Promise<T>): Promise<T> {
  if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

type Provider = 'gemini' | 'anthropic';

function pickProvider(): Provider {
  const env = getEnv();
  if (env.LLM_PROVIDER) return env.LLM_PROVIDER;
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'gemini';
}

/** Runs a request with retries. `send` performs one HTTP call; `read` extracts the text from a successful reply. */
async function request(
  send: () => Promise<Response>,
  read: (res: Response) => Promise<string>,
  errors: { authMessage: string; modelMessage: string },
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await send();
    } catch {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1500 * attempt);
        continue;
      }
      throw new AppError(500, 'AI_UNREACHABLE', 'Could not reach the AI service. Check your connection and try again.');
    }

    if (res.ok) {
      const text = await read(res);
      if (!text.trim()) throw new AppError(500, 'AI_BAD_OUTPUT', 'The AI service returned an empty reply. Please try again.');
      return text;
    }

    if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep((res.status === 429 ? 4000 : 1500) * attempt);
      continue;
    }
    // Only the status is reported: response bodies can echo prompt text, which must not reach logs or the UI.
    if (res.status === 401 || res.status === 403) throw new AppError(500, 'AI_AUTH_FAILED', errors.authMessage);
    if (res.status === 404) throw new AppError(500, 'AI_MODEL_NOT_FOUND', errors.modelMessage);
    if (res.status === 429) {
      throw new AppError(500, 'AI_RATE_LIMITED', 'The AI service rate limit was hit (free tiers are limited per minute). Wait a minute and try again.');
    }
    throw new AppError(500, 'AI_UPSTREAM_ERROR', `The AI service returned an error (${res.status}). Please try again.`);
  }
  throw new AppError(500, 'AI_UPSTREAM_ERROR', 'The AI service did not respond. Please try again.');
}

const callGemini: Complete = async ({ system, user, maxTokens, temperature }) => {
  const env = getEnv();
  const key = env.GEMINI_API_KEY;
  if (!key) {
    throw new AppError(500, 'AI_NOT_CONFIGURED', 'AI generation is not configured. Set GEMINI_API_KEY in .env and restart the server.');
  }
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  // Newer Gemini models spend part of the output budget on internal "thinking", so leave generous headroom.
  const maxOutputTokens = Math.min(16_000, maxTokens * 4);

  return withSlot(GEMINI_CONCURRENCY, () =>
    request(
      () =>
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens, temperature: temperature ?? 0.8, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      async (res) => {
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        return parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      },
      {
        authMessage: 'The Gemini API key was rejected. Check GEMINI_API_KEY.',
        modelMessage: `The model "${model}" was not found. Check GEMINI_MODEL.`,
      },
    ),
  );
};

const callClaude: Complete = async ({ system, user, maxTokens, temperature }) => {
  const env = getEnv();
  const key = env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AppError(500, 'AI_NOT_CONFIGURED', 'AI generation is not configured. Set ANTHROPIC_API_KEY in .env and restart the server.');
  }
  const model = env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL;
  return request(
    () =>
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          ...(temperature !== undefined ? { temperature } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    async (res) => {
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    },
    {
      authMessage: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.',
      modelMessage: `The model "${model}" was not found. Check ANTHROPIC_MODEL.`,
    },
  );
};

/** The default completion function: picks Gemini or Claude from the environment. */
export const callLlm: Complete = (args) => (pickProvider() === 'anthropic' ? callClaude(args) : callGemini(args));
