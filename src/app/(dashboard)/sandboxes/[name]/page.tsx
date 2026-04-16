"use client";

import { use } from "react";
import SandboxPage from "../page";

export default function SandboxEditRoute({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  return <SandboxPage autoEditName={decodeURIComponent(name)} />;
}
