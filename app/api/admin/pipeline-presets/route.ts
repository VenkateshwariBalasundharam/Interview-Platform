import { requireAdmin } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { getPreset, TIERS, TIER_PRESETS } from '@/lib/pipeline';

export const GET = route(async () => {
  await requireAdmin();
  const presets = TIERS.map((tier) => ({ tier, label: TIER_PRESETS[tier].label, ...getPreset(tier) }));
  return json({ presets });
});
