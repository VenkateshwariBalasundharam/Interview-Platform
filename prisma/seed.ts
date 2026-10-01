/* Idempotent seed: one admin, one sample job per tier preset, sample candidates.
 * Run with: npm run db:seed   (reads .env; needs SEED_ADMIN_PASSWORD) */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { generateCandidateCode } from '../lib/candidate-code';
import { getPreset, TIERS, type Tier } from '../lib/pipeline';
import { parseDob } from '../lib/dob';
import { seedCodingBank } from './coding-bank';

const prisma = new PrismaClient();

const SAMPLE_JOBS: Record<Tier, { title: string; jdText: string; requiredSkills: string[] }> = {
  FRESHER: {
    title: 'Junior Frontend Developer (sample)',
    jdText: 'Build and maintain responsive user interfaces with React and TypeScript. Work with designers and backend engineers, write clean components, and learn our testing practices.',
    requiredSkills: ['JavaScript', 'React', 'HTML', 'CSS'],
  },
  MID: {
    title: 'Full-Stack Developer (sample)',
    jdText: 'Own features end to end across a React frontend and a Node.js API backed by PostgreSQL. Review code, improve performance, and mentor junior engineers.',
    requiredSkills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL'],
  },
  SENIOR: {
    title: 'Senior Backend Engineer (sample)',
    jdText: 'Design and scale distributed backend services, lead architecture decisions, drive reliability practices, and partner with product and engineering managers.',
    requiredSkills: ['System design', 'Distributed systems', 'PostgreSQL', 'Cloud infrastructure'],
  },
};

// Fictional people. Their DOBs are listed in README.md for manual testing and are never printed here.
const SAMPLE_CANDIDATES: { tier: Tier; name: string; email: string; dob: string }[] = [
  { tier: 'FRESHER', name: 'Asha Verma', email: 'asha.verma@example.com', dob: '15-08-2001' },
  { tier: 'FRESHER', name: 'Ravi Kumar', email: 'ravi.kumar@example.com', dob: '02-03-2000' },
  { tier: 'FRESHER', name: 'Meera Nair', email: 'meera.nair@example.com', dob: '27-11-2002' },
  { tier: 'MID', name: 'Karthik Raja', email: 'karthik.raja@example.com', dob: '09-06-1996' },
  { tier: 'SENIOR', name: 'Divya Menon', email: 'divya.menon@example.com', dob: '21-01-1988' },
];

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Platform Admin';
  if (!email || password.length < 12) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (at least 12 characters) in .env before seeding.');
  }

  await prisma.adminUser.upsert({
    where: { email },
    update: { name, passwordHash: await bcrypt.hash(password, 10) },
    create: { email, name, passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log(`Admin ready: ${email}`);

  const jobIds = {} as Record<Tier, string>;
  for (const tier of TIERS) {
    const sample = SAMPLE_JOBS[tier];
    const existing = await prisma.job.findFirst({ where: { title: sample.title }, select: { id: true } });
    if (existing) {
      jobIds[tier] = existing.id;
      console.log(`Job exists: ${sample.title}`);
      continue;
    }
    const preset = getPreset(tier);
    const job = await prisma.job.create({
      data: {
        ...sample,
        tier,
        resultMode: preset.resultMode,
        retakePolicy: 'NONE',
        rounds: { create: preset.steps },
      },
      select: { id: true },
    });
    jobIds[tier] = job.id;
    console.log(`Job created: ${sample.title}`);
  }

  for (const c of SAMPLE_CANDIDATES) {
    const jobId = jobIds[c.tier];
    const found = await prisma.candidate.findUnique({ where: { jobId_email: { jobId, email: c.email } }, select: { candidateCode: true } });
    if (found) {
      console.log(`Candidate exists: ${found.candidateCode} (${c.name})`);
      continue;
    }
    const dob = parseDob(c.dob);
    if (!dob.ok) throw new Error(`Bad sample DOB for ${c.name}`);
    let candidateCode = generateCandidateCode();
    while (await prisma.candidate.findUnique({ where: { candidateCode }, select: { id: true } })) candidateCode = generateCandidateCode();
    await prisma.candidate.create({
      data: { candidateCode, name: c.name, email: c.email, dobHash: await bcrypt.hash(dob.password, 10), jobId },
    });
    console.log(`Candidate created: ${candidateCode} (${c.name}, ${c.tier})`);
  }

  const bank = await seedCodingBank(prisma);
  console.log(`Coding problems: ${bank.added} added, ${bank.existing} already there`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
