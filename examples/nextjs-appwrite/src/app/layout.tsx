import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Somni Chat — Appwrite + Next.js Example',
  description: 'Production-grade chat powered by Somni Chat Engine',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
