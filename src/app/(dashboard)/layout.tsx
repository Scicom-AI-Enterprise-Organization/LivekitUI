import { redirect } from "next/navigation";
import { LiveKitSidebar } from "@/components/livekit/sidebar";
import { getSession } from "@/lib/auth";

export const metadata = {
  title: "LiveKit Cloud",
  description: "LiveKit Cloud Dashboard",
};

export default async function LiveKitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The middleware only sees whether a session cookie exists — it cannot reach
  // the database. Validate it here, or a stale cookie renders the whole
  // dashboard with every API call failing 401: empty tables, missing
  // owner-only actions, and no hint that you need to sign in again.
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <LiveKitSidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
