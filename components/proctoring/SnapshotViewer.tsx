'use client';
import { useState } from 'react';
import { Camera, X } from 'lucide-react';

/**
 * The photo kept for one face event. The image is requested only when the admin presses the button, so a view is
 * audited only when someone actually looks. The route is admin-only, never cached, and answers 404 once the photo expires.
 */
export function SnapshotViewer({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setOpen(true);
        }}
        className="ml-2 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium hover:bg-muted"
      >
        <Camera className="h-3 w-3" aria-hidden /> View photo
      </button>
    );
  }

  return (
    <span className="mt-2 block">
      {failed ? (
        <span className="text-xs text-muted-foreground">This photo is no longer available (photos are deleted after the retention period).</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/admin/proctor-snapshots/${encodeURIComponent(eventId)}`}
          alt="Camera photo taken when this event was recorded"
          className="max-h-60 rounded-md border"
          onError={() => setFailed(true)}
        />
      )}
      <button type="button" onClick={() => setOpen(false)} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline">
        <X className="h-3 w-3" aria-hidden /> Hide
      </button>
    </span>
  );
}
