// Runs the background sweep from the command line.
//   npm run sweep                one run, then exit (use with a system cron: `* * * * * cd /path && npm run sweep`)
//   npm run sweep:watch          keeps running, one sweep per minute (handy in development or on a small server)
//   npm run sweep:watch -- --every 30     seconds between sweeps (10 to 3600)
import { runSweep } from '@/lib/sweeper';
import { summarizeReport } from '@/lib/sweeper-core';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const everyArg = args.indexOf('--every');
const everySec = Math.min(3600, Math.max(10, Number(everyArg >= 0 ? args[everyArg + 1] : 60) || 60));

async function once(): Promise<boolean> {
  try {
    const report = await runSweep({ trigger: 'script' });
    console.log(`[${new Date().toISOString()}] ${summarizeReport(report)}`);
    return report.errors === 0;
  } catch (e) {
    console.error('Sweep failed', e instanceof Error ? e.name : e);
    return false;
  }
}

if (!watch) {
  once().then((ok) => process.exit(ok ? 0 : 1));
} else {
  console.log(`Sweeping every ${everySec} s. Press Ctrl+C to stop.`);
  const loop = async () => {
    await once();
    setTimeout(() => void loop(), everySec * 1000);
  };
  void loop();
}
