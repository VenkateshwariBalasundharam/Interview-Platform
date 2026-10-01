import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { err } from '@/lib/http';
import { consumeRateLimit } from '@/lib/ratelimit';
import { signSession } from '@/lib/session';

export const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_EMAIL_LIMIT = 10;
const PER_IP_LIMIT = 40;

let dummyHash: string | null = null;
function getDummyHash() {
  dummyHash ??= bcrypt.hashSync('not-a-real-password', 10);
  return dummyHash;
}

export async function loginAdmin(input: { email: string; password: string; ip: string }) {
  const perIp = await consumeRateLimit(`admin-login:ip:${input.ip}`, PER_IP_LIMIT, WINDOW_MS);
  const perPair = await consumeRateLimit(`admin-login:${input.ip}:${input.email}`, PER_IP_EMAIL_LIMIT, WINDOW_MS);
  if (!perIp.allowed || !perPair.allowed) {
    throw err.tooMany(Math.max(perIp.retryAfterSec, perPair.retryAfterSec), 'Too many login attempts. Try again later.');
  }

  const admin = await prisma.adminUser.findUnique({ where: { email: input.email } });
  // Always run one bcrypt comparison so response time does not reveal whether the email exists.
  const matches = await bcrypt.compare(input.password, admin?.passwordHash ?? getDummyHash());
  if (!admin || !matches) throw err.unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');

  const maxAge = getEnv().ADMIN_SESSION_HOURS * 3600;
  const token = await signSession({ role: 'admin', sub: admin.id }, maxAge);
  await audit({ actorType: 'ADMIN', actorId: admin.id, action: 'ADMIN_LOGIN', entity: 'AdminUser', entityId: admin.id });
  return { token, maxAge, admin: { id: admin.id, email: admin.email, name: admin.name } };
}
