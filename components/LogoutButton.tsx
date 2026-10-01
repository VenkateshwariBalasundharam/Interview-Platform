'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';

export function LogoutButton({ endpoint, redirectTo }: { endpoint: string; redirectTo: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await apiFetch(endpoint, { method: 'POST' });
        } finally {
          router.replace(redirectTo);
          router.refresh();
        }
      }}
    >
      Log out
    </Button>
  );
}
