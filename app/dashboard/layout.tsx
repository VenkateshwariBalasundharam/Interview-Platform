import { DesktopOnlyNotice } from '@/components/DesktopOnlyNotice';

// Reads the session cookie and the database on every request; never prerender.
export const dynamic = 'force-dynamic';

export default function CandidateLayout({ children }: { children: React.ReactNode }) {
  return <DesktopOnlyNotice>{children}</DesktopOnlyNotice>;
}
