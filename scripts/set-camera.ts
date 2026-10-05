// Turns "Camera required" on or off for rounds, straight in the database. For testing on a computer without a webcam,
// or to change a job whose pipeline is locked because candidates have already started.
//
//   npx tsx --env-file=.env --tsconfig tsconfig.json scripts/set-camera.ts off                  every round of every job
//   npx tsx --env-file=.env --tsconfig tsconfig.json scripts/set-camera.ts on                   put it back
//   npx tsx --env-file=.env --tsconfig tsconfig.json scripts/set-camera.ts off --job <jobId>    one job
//   npx tsx --env-file=.env --tsconfig tsconfig.json scripts/set-camera.ts off --round TECHNICAL
//   npx tsx --env-file=.env --tsconfig tsconfig.json scripts/set-camera.ts status               show the current setting
//
// "off" means: a candidate whose camera does not work can continue without it (and the admin sees that).
import { prisma } from '@/lib/db';

const ROUND_TYPES = ['ASSESSMENT', 'TECHNICAL', 'CODING', 'SYSTEM_DESIGN', 'SCENARIO', 'HR', 'MANAGER'];

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'on' && mode !== 'off' && mode !== 'status') {
    console.error('Usage: set-camera.ts <on|off|status> [--job <jobId>] [--round <ROUND_TYPE>]');
    return 1;
  }
  const jobId = flag('--job');
  const roundType = flag('--round');
  if (process.argv.includes('--job') && !jobId) return (console.error('--job needs a job id'), 1);
  if (process.argv.includes('--round') && (!roundType || !ROUND_TYPES.includes(roundType))) {
    console.error(`--round must be one of: ${ROUND_TYPES.join(', ')}`);
    return 1;
  }

  const where = { ...(jobId ? { jobId } : {}), ...(roundType ? { roundType: roundType as never } : {}) };

  if (mode !== 'status') {
    const { count } = await prisma.roundConfig.updateMany({ where, data: { cameraRequired: mode === 'on' } });
    console.log(`Camera required set to ${mode === 'on' ? 'ON' : 'OFF'} for ${count} round(s).`);
    if (count === 0) console.log('Nothing matched. Check the job id and round type.');
  }

  const rows = await prisma.roundConfig.findMany({
    where,
    orderBy: [{ jobId: 'asc' }, { position: 'asc' }],
    select: { jobId: true, roundType: true, proctoringLevel: true, cameraRequired: true, job: { select: { title: true } } },
  });
  for (const r of rows) {
    console.log(`${r.job.title.padEnd(28).slice(0, 28)} ${r.jobId}  ${r.roundType.padEnd(14)} face=${r.proctoringLevel.padEnd(8)} camera required: ${r.cameraRequired ? 'yes' : 'NO'}`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('Failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
