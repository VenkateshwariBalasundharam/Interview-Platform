'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BackButtonProps {
  /** Always go to this page (used on login pages). Without it, the button goes back in history. */
  href?: string;
  /** Page to open when there is no history (for example a page opened in a new tab). Defaults to the parent path. */
  fallback?: string;
  /** Hide the button on these exact paths (for example the admin home page). */
  hideOn?: string[];
  label?: string;
}

export function BackButton({ href, fallback, hideOn = [], label = 'Back' }: BackButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  if (hideOn.includes(pathname)) return null;

  const content = (
    <>
      <ArrowLeft className="h-4 w-4" />
      {label}
    </>
  );

  if (href) {
    return (
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link href={href}>{content}</Link>
      </Button>
    );
  }

  const parent = pathname.split('/').slice(0, -1).join('/') || '/';
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback ?? parent);
      }}
    >
      {content}
    </Button>
  );
}
