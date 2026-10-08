'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-reads the page's data every few seconds so live numbers (rounds in progress, outcomes) change without a manual reload.
 * It pauses while the browser tab is hidden and refreshes once as soon as the tab is shown again, so a tab left open in the
 * background does not keep querying the database.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const refresh = () => {
      router.refresh();
      setUpdatedAt(new Date());
    };
    const stop = () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
    const start = () => {
      stop();
      timer.current = setInterval(refresh, Math.max(5, seconds) * 1000);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router, seconds]);

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="off">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
      Live: updates every {seconds} seconds{updatedAt ? ` · last ${updatedAt.toLocaleTimeString()}` : ''}
    </p>
  );
}
