"use client";

import { createContext, useContext } from "react";
import type { RuntimeConfig } from "@/lib/runtime-config";

/**
 * Carries the deployment's runtime config from the dashboard layout (a server
 * component, so it reads the live environment) down to the client pages that
 * need it. See `src/lib/runtime-config.ts` for why these cannot be read from
 * `process.env.NEXT_PUBLIC_*` in the browser.
 *
 * There is deliberately no default config. A localhost-shaped fallback here
 * would reintroduce exactly the failure this provider exists to prevent: a
 * page that looks fine, dials `ws://localhost:7880` from a public hostname,
 * and reports it as an unrelated "invalid API key". Rendering a consumer
 * outside the provider is a wiring mistake, so it should say so.
 */
const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

export function RuntimeConfigProvider({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: React.ReactNode;
}) {
  return (
    <RuntimeConfigContext.Provider value={config}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  const config = useContext(RuntimeConfigContext);
  if (!config) {
    throw new Error(
      "useRuntimeConfig() outside RuntimeConfigProvider — it is mounted in the (dashboard) layout, so this component is rendering somewhere else."
    );
  }
  return config;
}
