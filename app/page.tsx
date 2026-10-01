import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Interview Platform</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in with the credentials you were given.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild><Link href="/login">Candidate login</Link></Button>
        <Button asChild variant="outline"><Link href="/admin/login">Admin login</Link></Button>
      </div>
    </main>
  );
}
