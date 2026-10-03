// Starts `next dev` and first prints the two sign-in URLs, because Next.js only prints the root URL.
// Usage: npm run dev            (port 3100)
//        npm run dev -- 4000    (any other port)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const port = process.argv[2] || process.env.PORT || '3100';
const base = `http://localhost:${port}`;

console.log('');
console.log('  Interview Platform');
console.log(`  - Candidate login: ${base}/login`);
console.log(`  - Admin login:     ${base}/staff-login`);
console.log('');

const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'dev', '-p', port], { stdio: 'inherit' });

child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
