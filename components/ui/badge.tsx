import * as React from 'react';
import { cn } from '@/lib/utils';

const tones = {
  neutral: 'bg-secondary text-secondary-foreground',
  good: 'bg-accent text-accent-foreground',
  warn: 'bg-amber-100 text-amber-900',
  bad: 'bg-red-100 text-red-800',
} as const;

export function Badge({ tone = 'neutral', className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)} {...props} />;
}
