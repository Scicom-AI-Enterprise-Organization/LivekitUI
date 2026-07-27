import { TopBar } from "@/components/livekit/top-bar";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { ApiDocs } from "./api-docs";

export const metadata = {
  title: "API docs — LiveKit Cloud",
  description: "REST API reference for the LiveKit dashboard",
};

export default function ApiDocsPage() {
  // Shown in the curl samples so they can be copied and run as-is.
  const baseUrl = process.env.DASHBOARD_URL || getRuntimeConfig().sandboxDomain;

  return (
    <div className="flex h-full flex-col">
      <TopBar title="API docs" />
      <div className="min-h-0 flex-1">
        <ApiDocs baseUrl={baseUrl.replace(/\/$/, "")} />
      </div>
    </div>
  );
}
