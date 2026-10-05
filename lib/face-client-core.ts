// Pure rules for the camera side of face checks. No browser APIs and no server code here, so everything in this
// file is unit tested (tests/face-client.test.ts). The browser code in lib/face-client.ts and
// components/proctoring/FaceMonitor.tsx only wires these rules to the camera.
//
// The browser reports what it saw; lib/face-core.ts (server) decides which events that is worth.

/** Time between camera readings during a round. The server stores the same kind of event at most once per 15 s. */
export const DETECT_EVERY_MS = 3000;
/** After a 429 from the server, wait this long before the next reading. */
export const BACKOFF_MS = 10_000;
/** Face readings taken when the candidate registers their face. */
export const ENROLL_SAMPLES = 5;
export const ENROLL_SAMPLE_GAP_MS = 700;
/** Registration samples farther apart than this are not the same face in the same pose; ask the candidate to retry. */
export const ENROLL_MAX_SPREAD = 0.45;
/** Where the nose sits between the two jaw edges: 0.5 is facing the screen. Outside this band the head is turned away. */
export const YAW_MIN = 0.3;
export const YAW_MAX = 0.7;
/** Stay under the server's 150 KB limit with room to spare. */
export const SNAPSHOT_TARGET_BYTES = 140 * 1024;
export const SNAPSHOT_WIDTHS = [480, 360, 240] as const;
export const SNAPSHOT_QUALITIES = [0.7, 0.55, 0.4, 0.3] as const;
export const DESCRIPTOR_DIM = 128;

export interface Point {
  x: number;
  y: number;
}

/**
 * Head turn from the 68-point landmarks: jaw edge (0), jaw edge (16), nose tip (30).
 * Returns the nose position between the jaw edges (0 = at the left edge, 1 = at the right edge), or null when the
 * landmarks are missing or the face is too narrow to judge.
 */
export function yawRatio(points: readonly Point[]): number | null {
  if (points.length < 68) return null;
  const left = points[0];
  const right = points[16];
  const nose = points[30];
  const width = right.x - left.x;
  if (!Number.isFinite(width) || Math.abs(width) < 20) return null;
  const ratio = (nose.x - left.x) / width;
  return Number.isFinite(ratio) ? ratio : null;
}

export function isLookingAway(points: readonly Point[]): boolean {
  const ratio = yawRatio(points);
  return ratio !== null && (ratio < YAW_MIN || ratio > YAW_MAX);
}

export function distance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/** Plain numbers, rounded, in the shape the server accepts (128 finite values between -5 and 5). */
export function toDescriptorArray(raw: ArrayLike<number>): number[] | null {
  if (raw.length !== DESCRIPTOR_DIM) return null;
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (!Number.isFinite(v) || v < -5 || v > 5) return null;
    out.push(Math.round(v * 1e6) / 1e6);
  }
  return out;
}

export function averageDescriptors(list: readonly (readonly number[])[]): number[] | null {
  if (list.length === 0) return null;
  const dim = list[0].length;
  if (dim !== DESCRIPTOR_DIM || list.some((d) => d.length !== dim)) return null;
  const out = new Array<number>(dim).fill(0);
  for (const d of list) for (let i = 0; i < dim; i++) out[i] += d[i];
  return out.map((v) => Math.round((v / list.length) * 1e6) / 1e6);
}

export function maxPairwiseDistance(list: readonly (readonly number[])[]): number {
  let max = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) max = Math.max(max, distance(list[i], list[j]));
  return max;
}

export type EnrollmentVerdict = { ok: true; descriptor: number[] } | { ok: false; reason: 'too_few' | 'inconsistent' };

/** Registration succeeds only with enough single-face samples that agree with each other. The average is stored. */
export function enrollmentVerdict(samples: readonly (readonly number[])[], needed = ENROLL_SAMPLES): EnrollmentVerdict {
  if (samples.length < needed) return { ok: false, reason: 'too_few' };
  if (maxPairwiseDistance(samples) > ENROLL_MAX_SPREAD) return { ok: false, reason: 'inconsistent' };
  const descriptor = averageDescriptors(samples);
  return descriptor ? { ok: true, descriptor } : { ok: false, reason: 'too_few' };
}

export const ENROLL_MESSAGES = {
  too_few: 'We could not see exactly one face clearly enough. Sit alone, face the camera in good light, and try again.',
  inconsistent: 'The readings did not agree with each other. Hold still, look straight at the camera, and try again.',
} as const;

/** Next step to try for a JPEG that was `size` bytes at the given step; null when it fits or nothing smaller is left. */
export function nextSnapshotStep(step: number, size: number): number | null {
  if (size <= SNAPSHOT_TARGET_BYTES) return null;
  const total = SNAPSHOT_WIDTHS.length * SNAPSHOT_QUALITIES.length;
  return step + 1 < total ? step + 1 : null;
}

/** Step index -> width and quality: all qualities at the widest size first, then the next width down. */
export function snapshotStep(step: number): { width: number; quality: number } {
  const w = Math.min(Math.floor(step / SNAPSHOT_QUALITIES.length), SNAPSHOT_WIDTHS.length - 1);
  const q = step % SNAPSHOT_QUALITIES.length;
  return { width: SNAPSHOT_WIDTHS[w], quality: SNAPSHOT_QUALITIES[q] };
}

/** What the browser sends for one reading. Mirrors faceCheckSchema in lib/face-core.ts. */
export interface FaceReading {
  faces: number;
  lookingAway?: boolean;
  embedding?: number[];
  msAgo: number;
}

/** Builds the request body from what the camera saw. A descriptor and a head turn only count with exactly one face. */
export function buildReading(
  seen: { faces: number; landmarks?: readonly Point[]; descriptor?: ArrayLike<number> },
  withDescriptor: boolean,
  msAgo: number,
): FaceReading {
  const faces = Math.max(0, Math.min(10, Math.floor(seen.faces)));
  const reading: FaceReading = { faces, msAgo: Math.max(0, Math.min(60_000, Math.round(msAgo))) };
  if (faces === 1) {
    if (seen.landmarks) reading.lookingAway = isLookingAway(seen.landmarks);
    if (withDescriptor && seen.descriptor) {
      const embedding = toDescriptorArray(seen.descriptor);
      if (embedding) reading.embedding = embedding;
    }
  }
  return reading;
}

/** Server answers after which readings must stop for good (round over, signed out, consent missing). */
export function isFinalStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 409;
}
