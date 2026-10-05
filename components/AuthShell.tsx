import { ClipboardCheck } from 'lucide-react';

/**
 * The one look for every sign-in page (candidate and admin): dark brand panel on the left, the form on the right.
 * Same colours as the admin sidebar, so signing in and using the app feel like one product.
 */
export function AuthShell({ title, description, children, note }: { title: string; description: string; children: React.ReactNode; note?: string }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-[#0b1530] p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600"><ClipboardCheck className="h-5 w-5" aria-hidden /></span>
          <span className="text-lg font-semibold">Interview Platform</span>
        </div>
        <div>
          <h2 className="max-w-sm text-3xl font-semibold leading-tight">Structured interviews, one round at a time.</h2>
          <p className="mt-4 max-w-sm text-sm text-slate-300">Online rounds, fair scoring and a clear record for everyone involved in the hiring process.</p>
        </div>
        <p className="text-xs text-slate-400">© {new Date().getFullYear()} Interview Platform</p>
      </section>

      <section className="flex items-center justify-center bg-[#f4f6fb] p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0b1530] text-white"><ClipboardCheck className="h-5 w-5" aria-hidden /></span>
            <span className="text-base font-semibold">Interview Platform</span>
          </div>
          <div className="rounded-xl border bg-card p-8 shadow-sm">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            <div className="mt-6">{children}</div>
          </div>
          {note && <p className="mt-4 text-center text-xs text-muted-foreground">{note}</p>}
        </div>
      </section>
    </main>
  );
}
