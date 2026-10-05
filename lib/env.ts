import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(8),
  CANDIDATE_SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(12),
  // Phase 2: AI question generation. Optional so the rest of the app runs without a key.
  LLM_PROVIDER: z.enum(['gemini', 'anthropic']).optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  // Phase 2: folder for private resume files (outside public/). Defaults to .private-storage in the project folder.
  STORAGE_DIR: z.string().optional(),
  // Phase 4: by default an AI-graded score can flag a candidate for review but never disqualify on its own.
  AI_GRADING_CAN_DISQUALIFY: z.enum(['true', 'false']).optional(),
  // Phase 5: Judge0 code runner for the Coding round. Self-hosted (JUDGE0_URL only) or RapidAPI (add key and host).
  JUDGE0_URL: z.string().url().optional(),
  JUDGE0_API_KEY: z.string().optional(),
  JUDGE0_API_HOST: z.string().optional(),
  // Optional JSON override of Judge0 language ids, e.g. {"python":100,"javascript":102}
  JUDGE0_LANGUAGE_IDS: z.string().optional(),
  // Phase 6: face checks. FACE_ENCRYPTION_KEY is 32 random bytes, base64. Without it face checks stay off.
  FACE_ENCRYPTION_KEY: z.string().optional(),
  // Days that snapshots and face references are kept before the purge removes them (1 to 365, default 30).
  RETENTION_DAYS: z.string().optional(),
  // Distance above which two faces count as different people (0.3 to 0.9, default 0.6).
  FACE_MATCH_THRESHOLD: z.string().optional(),
  // Background sweep: the scheduler calls /api/cron/sweep with `Authorization: Bearer <CRON_SECRET>` (16+ characters). Without it the route stays closed.
  CRON_SECRET: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Validated environment. Read lazily so `next build` does not need secrets. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
