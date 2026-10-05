import { Prisma, PrismaClient } from '@prisma/client';

// Neon's free tier suspends idle databases and closes their connections (Postgres code E57P01). Prisma reconnects on
// the next request, so those lines are just noise; every other database error is still printed.
const IDLE_SHUTDOWN = /E57P01|terminating connection due to administrator command/;

function createClient() {
  // PRISMA_QUERY_LOG=1 prints how long each database query took, to find out what makes a page slow.
  const logQueries = process.env.PRISMA_QUERY_LOG === '1';
  const client = new PrismaClient({ log: [{ level: 'error', emit: 'event' }, ...(logQueries ? [{ level: 'query' as const, emit: 'event' as const }] : [])] });
  client.$on('error', (e: Prisma.LogEvent) => {
    if (IDLE_SHUTDOWN.test(e.message)) return;
    console.error(`prisma:error ${e.message}`);
  });
  if (logQueries) {
    // Only the duration and the start of the statement are printed; query parameters are never shown.
    (client as unknown as { $on: (event: 'query', cb: (e: Prisma.QueryEvent) => void) => void }).$on('query', (e) => {
      console.log(`prisma:query ${String(e.duration).padStart(4)} ms  ${e.query.replace(/\s+/g, ' ').slice(0, 90)}`);
    });
  }
  return client;
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
