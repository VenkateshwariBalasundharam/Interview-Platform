import { requireAdmin } from '@/lib/auth';
import { json, route } from '@/lib/http';

export const GET = route(async () => {
  const admin = await requireAdmin();
  return json({ admin: { name: admin.name, email: admin.email } });
});
