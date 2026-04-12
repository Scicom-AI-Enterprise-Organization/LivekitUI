import { LiveKitSidebar } from "@/components/livekit/sidebar";

export const metadata = {
  title: "LiveKit Cloud",
  description: "LiveKit Cloud Dashboard",
};

export default function LiveKitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <LiveKitSidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
