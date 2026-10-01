'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';

export function CandidateLoginForm() {
  const router = useRouter();
  const [candidateCode, setCode] = useState('');
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/candidate/auth/login', { method: 'POST', json: { candidateCode, dob } });
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="code">Candidate ID</Label>
        <Input id="code" autoComplete="username" placeholder="Candidate ID, e.g. CAND-KQMT1001" value={candidateCode} onChange={(e) => setCode(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dob">Password (your date of birth, DDMMYYYY)</Label>
        <Input id="dob" type="password" inputMode="numeric" autoComplete="current-password" placeholder="DDMMYYYY" value={dob} onChange={(e) => setDob(e.target.value)} required />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
