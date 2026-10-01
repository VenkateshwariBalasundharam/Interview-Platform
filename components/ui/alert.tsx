import * as React from 'react';
import { cn } from '@/lib/utils';

const tones = {
  info: 'border-border bg-muted text-foreground',
  error: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
} as const;

export function Alert({ tone = 'info', className, ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof tones }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-md border px-3 py-2 text-sm', tones[tone], className)} {...props} />;
}
