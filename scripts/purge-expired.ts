// Removes snapshots and face references older than RETENTION_DAYS. Run daily: npm run purge
import { purgeExpired } from '@/lib/face';

purgeExpired()
  .then((r) => {
    console.log(`Removed ${r.snapshots} snapshot(s) and ${r.faceReferences} face reference(s).`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('Purge failed', e instanceof Error ? e.name : e);
    process.exit(1);
  });
