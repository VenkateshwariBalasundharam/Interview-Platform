import type { ReactNode } from 'react';

/**
 * Wrap exam pages. Below 1024px the exam is hidden behind a notice; CSS-only, so nothing loads or runs
 * for the hidden content's interactive parts until a wide screen is used.
 */
export function DesktopOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="flex min-h-screen items-center justify-center p-8 lg:hidden">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Use a laptop or desktop</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The exam needs a larger screen and a keyboard. Open this page on a laptop or desktop computer to continue.
          </p>
        </div>
      </div>
      <div className="hidden lg:block">{children}</div>
    </>
  );
}
