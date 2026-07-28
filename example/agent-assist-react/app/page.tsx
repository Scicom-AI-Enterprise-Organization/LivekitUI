import { AssistApp } from '@/components/assist-app';
import { assistConfig } from '@/lib/server-config';

/**
 * Server component on purpose: the LiveKit URL, the room and the worker name are
 * read from the running process's environment and handed down as props. Reading
 * them through `NEXT_PUBLIC_*` in the client would freeze them into the bundle
 * at build time, and one built sandbox would stop working for the next.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const { room } = await searchParams;
  return <AssistApp config={assistConfig(room)} />;
}
