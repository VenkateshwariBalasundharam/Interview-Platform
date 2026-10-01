import { Prisma, PrismaClient } from '@prisma/client';

// Neon's free tier suspends idle databases and closes their connections (Postgres code E57P01). Prisma reconnects on
// the next request, so those lines are just noise; every other database error is still printed.
const IDLE_SHUTDOWN = /E57P01|terminating connection due to administrator command/;

function createClient() {
  const client = new PrismaClient({ log: [{ level: 'error', emit: 'event' }] });
  client.$on('error', (e: Prisma.LogEvent) => {
    if (IDLE_SHUTDOWN.test(e.message)) return;
    console.error(`prisma:error ${e.message}`);
  });
  return client;
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
