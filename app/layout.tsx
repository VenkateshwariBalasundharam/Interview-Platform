import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Interview Platform',
  description: 'Configurable multi-round online interviews',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
