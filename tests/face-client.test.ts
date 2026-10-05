import { describe, expect, it } from 'vitest';
import {
  DESCRIPTOR_DIM,
  ENROLL_MAX_SPREAD,
  SNAPSHOT_QUALITIES,
  SNAPSHOT_TARGET_BYTES,
  SNAPSHOT_WIDTHS,
  averageDescriptors,
  buildReading,
  distance,
  enrollmentVerdict,
  isFinalStatus,
  isLookingAway,
  maxPairwiseDistance,
  nextSnapshotStep,
  snapshotStep,
  toDescriptorArray,
  yawRatio,
  type Point,
} from '@/lib/face-client-core';
import { faceCheckSchema, enrollSchema } from '@/lib/face-core';

/** 68 points with the jaw edges at x=100 and x=200 and the nose at the given x. */
function landmarks(noseX: number, left = 100, right = 200): Point[] {
  const pts: Point[] = Array.from({ length: 68 }, () => ({ x: 150, y: 150 }));
  pts[0] = { x: left, y: 140 };
  pts[16] = { x: right, y: 140 };
  pts[30] = { x: noseX, y: 150 };
  return pts;
}

const vec = (base: number, bump = 0) => Array.from({ length: DESCRIPTOR_DIM }, (_, i) => base + (i === 0 ? bump : 0) + i / 10_000);

describe('head turn', () => {
  it('reads facing the screen as centred', () => {
    expect(yawRatio(landmarks(150))).toBeCloseTo(0.5);
    expect(isLookingAway(landmarks(150))).toBe(false);
    expect(isLookingAway(landmarks(135))).toBe(false);
  });
  it('flags a clearly turned head on either side', () => {
    expect(isLookingAway(landmarks(115))).toBe(true);
    expect(isLookingAway(landmarks(185))).toBe(true);
  });
  it('cannot judge missing or tiny landmarks, and does not flag them', () => {
    expect(yawRatio([])).toBeNull();
    expect(yawRatio(landmarks(150, 100, 110))).toBeNull();
    expect(isLookingAway(landmarks(150, 100, 110))).toBe(false);
  });
});

describe('descriptors', () => {
  it('rounds plain numbers and rejects wrong sizes or wild values', () => {
    const f32 = new Float32Array(DESCRIPTOR_DIM).fill(0.123456789);
    const out = toDescriptorArray(f32);
    expect(out).toHaveLength(DESCRIPTOR_DIM);
    expect(out![0]).toBeCloseTo(0.123457, 5);
    expect(toDescriptorArray(new Float32Array(10))).toBeNull();
    expect(toDescriptorArray(new Array(DESCRIPTOR_DIM).fill(9))).toBeNull();
    expect(toDescriptorArray(new Array(DESCRIPTOR_DIM).fill(Number.NaN))).toBeNull();
  });
  it('averages, and refuses mixed sizes or nothing', () => {
    const avg = averageDescriptors([vec(0.1), vec(0.3)])!;
    expect(avg[5]).toBeCloseTo(0.2005, 4);
    expect(averageDescriptors([])).toBeNull();
    expect(averageDescriptors([vec(0.1), [1, 2, 3]])).toBeNull();
  });
  it('measures distance like the server does', () => {
    expect(distance(vec(0.1), vec(0.1))).toBe(0);
    expect(distance([0, 0], [3, 4])).toBe(5);
    expect(distance([1], [1, 2])).toBe(Number.POSITIVE_INFINITY);
    expect(maxPairwiseDistance([vec(0.1), vec(0.1, 0.2), vec(0.1, 0.1)])).toBeCloseTo(0.2, 5);
  });
});

describe('registration', () => {
  it('needs enough samples', () => {
    expect(enrollmentVerdict([vec(0.1), vec(0.1)])).toEqual({ ok: false, reason: 'too_few' });
  });
  it('refuses samples that disagree', () => {
    const samples = [vec(0.1), vec(0.1), vec(0.1), vec(0.1), vec(0.1, ENROLL_MAX_SPREAD + 0.2)];
    expect(enrollmentVerdict(samples)).toEqual({ ok: false, reason: 'inconsistent' });
  });
  it('stores the average of samples that agree, in a shape the server accepts', () => {
    const samples = [vec(0.1), vec(0.11), vec(0.12), vec(0.1), vec(0.11)];
    const verdict = enrollmentVerdict(samples);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(enrollSchema.safeParse({ embedding: verdict.descriptor }).success).toBe(true);
  });
});

describe('readings', () => {
  it('sends only a count when nobody or several people are seen', () => {
    expect(buildReading({ faces: 0 }, true, 100)).toEqual({ faces: 0, msAgo: 100 });
    const many = buildReading({ faces: 3, landmarks: landmarks(115), descriptor: new Float32Array(DESCRIPTOR_DIM) }, true, 0);
    expect(many).toEqual({ faces: 3, msAgo: 0 });
  });
  it('adds head turn and descriptor for exactly one face', () => {
    const r = buildReading({ faces: 1, landmarks: landmarks(115), descriptor: new Float32Array(DESCRIPTOR_DIM).fill(0.2) }, true, 250);
    expect(r.lookingAway).toBe(true);
    expect(r.embedding).toHaveLength(DESCRIPTOR_DIM);
  });
  it('leaves the descriptor out at presence level', () => {
    const r = buildReading({ faces: 1, landmarks: landmarks(150), descriptor: new Float32Array(DESCRIPTOR_DIM).fill(0.2) }, false, 0);
    expect(r.embedding).toBeUndefined();
    expect(r.lookingAway).toBe(false);
  });
  it('clamps counts and age so the server accepts every body', () => {
    const r = buildReading({ faces: 99 }, false, 999_999);
    expect(r).toEqual({ faces: 10, msAgo: 60_000 });
    expect(faceCheckSchema.safeParse(r).success).toBe(true);
    const one = buildReading({ faces: 1, landmarks: landmarks(150), descriptor: new Float32Array(DESCRIPTOR_DIM).fill(0.2) }, true, 5);
    expect(faceCheckSchema.safeParse(one).success).toBe(true);
  });
});

describe('snapshot sizing', () => {
  it('stops as soon as the photo is small enough', () => {
    expect(nextSnapshotStep(0, SNAPSHOT_TARGET_BYTES)).toBeNull();
  });
  it('walks down through every quality and width, then gives up', () => {
    const total = SNAPSHOT_WIDTHS.length * SNAPSHOT_QUALITIES.length;
    let step = 0;
    let guard = 0;
    for (let next = nextSnapshotStep(step, SNAPSHOT_TARGET_BYTES + 1); next !== null; next = nextSnapshotStep(step, SNAPSHOT_TARGET_BYTES + 1)) {
      step = next;
      guard++;
      if (guard > 100) throw new Error('did not stop');
    }
    expect(step).toBe(total - 1);
  });
  it('starts at the widest size and best quality and ends at the smallest', () => {
    expect(snapshotStep(0)).toEqual({ width: SNAPSHOT_WIDTHS[0], quality: SNAPSHOT_QUALITIES[0] });
    const last = SNAPSHOT_WIDTHS.length * SNAPSHOT_QUALITIES.length - 1;
    expect(snapshotStep(last)).toEqual({ width: SNAPSHOT_WIDTHS[SNAPSHOT_WIDTHS.length - 1], quality: SNAPSHOT_QUALITIES[SNAPSHOT_QUALITIES.length - 1] });
  });
});

describe('server answers', () => {
  it('stops for good on auth, missing or conflict, but keeps going on busy or broken', () => {
    for (const s of [401, 403, 404, 409]) expect(isFinalStatus(s)).toBe(true);
    for (const s of [200, 400, 429, 500, 503]) expect(isFinalStatus(s)).toBe(false);
  });
});
