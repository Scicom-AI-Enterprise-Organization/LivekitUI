"use client";

import SandboxPage from "../page";

/* Same view as /sandboxes — SandboxPage reads the [name] route param itself
   and opens that app's edit dialog. */
export default function SandboxEditRoute() {
  return <SandboxPage />;
}
