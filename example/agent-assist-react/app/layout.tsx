import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent assist',
  description: 'Live transcription and real-time coaching for a call between two people',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
