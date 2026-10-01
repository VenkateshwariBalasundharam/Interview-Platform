import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma } from '@/lib/db';

export default async function AdminHome() {
  const [jobs, candidates, attempts] = await Promise.all([prisma.job.count(), prisma.candidate.count(), prisma.attempt.count()]);
  const stats = [
    { label: 'Jobs', value: jobs, href: '/admin/jobs' },
    { label: 'Candidates', value: candidates, href: '/admin/candidates' },
    { label: 'Attempts started', value: attempts, href: undefined },
  ];
  return (
    <>
      <h1 className="text-xl font-semibold">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
            </CardHeader>
            <CardContent>{s.href ? <Link href={s.href} className="text-sm underline">Open</Link> : <span className="text-sm text-muted-foreground">Starts in Phase 3</span>}</CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
