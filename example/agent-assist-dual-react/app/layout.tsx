import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent assist · dual track',
  description:
    'Live transcription and real-time coaching for a phone call published as two tracks from one desk',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
