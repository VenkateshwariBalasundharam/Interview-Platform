import { describe, expect, it } from 'vitest';
import { cameraSkipKey, parseSkipReason, skipReasonFor } from '@/lib/face-client-core';
import { defaultStep, getPreset, pipelineStepSchema, TIERS } from '@/lib/pipeline';
import { describeEvent, proctorBatchSchema, summarizeEvents, toStoredEvent, CAMERA_SKIP_REASONS } from '@/lib/proctoring-core';

const roundStart = new Date('2026-10-05T10:00:00Z');
const now = new Date('2026-10-05T10:05:00Z');

describe('camera setting on a round', () => {
  it('is required by default, so existing jobs behave as before', () => {
    expect(defaultStep('TECHNICAL', 1).cameraRequired).toBe(true);
    const { cameraRequired, ...withoutIt } = defaultStep('TECHNICAL', 1);
    expect(cameraRequired).toBe(true);
    expect(pipelineStepSchema.parse(withoutIt).cameraRequired).toBe(true);
  });
  it('can be switched off per round, and every preset starts required', () => {
    expect(pipelineStepSchema.parse({ ...defaultStep('CODING', 2), cameraRequired: false }).cameraRequired).toBe(false);
    for (const tier of TIERS) for (const s of getPreset(tier).steps) expect(s.cameraRequired).toBe(true);
  });
});

describe('"continued without a camera" event', () => {
  it('is accepted from the browser with a known reason only', () => {
    for (const reason of CAMERA_SKIP_REASONS) {
      expect(proctorBatchSchema.safeParse({ events: [{ type: 'CAMERA_UNAVAILABLE', msAgo: 0, reason }] }).success).toBe(true);
    }
    expect(proctorBatchSchema.safeParse({ events: [{ type: 'CAMERA_UNAVAILABLE', msAgo: 0, reason: 'because' }] }).success).toBe(false);
    expect(proctorBatchSchema.safeParse({ events: [{ type: 'CAMERA_UNAVAILABLE', msAgo: 0 }] }).success).toBe(false);
  });
  it('stores only the reason', () => {
    const parsed = proctorBatchSchema.parse({ events: [{ type: 'CAMERA_UNAVAILABLE', msAgo: 1000, reason: 'not_found', extra: 'dropped' }] });
    const stored = toStoredEvent(parsed.events[0], now, roundStart);
    expect(stored.type).toBe('CAMERA_UNAVAILABLE');
    expect(stored.meta).toEqual({ reason: 'not_found' });
  });
  it('is described in plain words for the admin, with the reason', () => {
    expect(describeEvent('CAMERA_UNAVAILABLE', { reason: 'denied' })).toEqual({
      text: 'The candidate continued without a camera (camera permission was blocked). No face checks ran for this round',
      tone: 'warn',
    });
    expect(describeEvent('CAMERA_UNAVAILABLE', { reason: 'not_found' }).text).toContain('no camera was found');
    expect(describeEvent('CAMERA_UNAVAILABLE', null).text).toContain('could not be started');
  });
  it('shows on the timeline without disturbing the counts', () => {
    const { counts, events } = summarizeEvents(
      [{ id: 'a', type: 'CAMERA_UNAVAILABLE', occurredAt: new Date('2026-10-05T10:00:05Z'), meta: { reason: 'in_use' } }],
      roundStart,
    );
    expect(events).toHaveLength(1);
    expect(events[0].offsetLabel).toBe('+0:05');
    expect(counts.noFace + counts.multipleFaces + counts.lookingAway + counts.identityMismatches + counts.tabSwitches).toBe(0);
  });
});

describe('camera skip helpers', () => {
  it('maps camera errors to the reason recorded', () => {
    expect(skipReasonFor('denied')).toBe('denied');
    expect(skipReasonFor('no_camera')).toBe('not_found');
    expect(skipReasonFor('in_use')).toBe('in_use');
    expect(skipReasonFor('unsupported')).toBe('other');
    expect(skipReasonFor('other')).toBe('other');
    expect(skipReasonFor(null)).toBe('other');
  });
  it('reads back only reasons it wrote', () => {
    expect(parseSkipReason('declined')).toBe('declined');
    expect(parseSkipReason('hacked')).toBeNull();
    expect(parseSkipReason(null)).toBeNull();
    expect(cameraSkipKey('CODING')).toBe('camera-skip:CODING');
  });
});
