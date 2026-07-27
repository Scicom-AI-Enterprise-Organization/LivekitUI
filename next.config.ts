import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"`. The standalone bundle chdir()s into
  // .next/standalone, and everything this app touches at runtime resolves from
  // process.cwd(): data/ (deployed agents, sandboxes, logs),
  // observer/session-observer.mjs, and example/<template> for scaffolding a
  // sandbox — whose node_modules live outside the bundle. Next also declines to
  // copy .next/static and public/ in, so assets 404. We run `next start` from the
  // project root instead, in Docker too.
  devIndicators: false,
  serverExternalPackages: ["child_process", "net", "better-sqlite3"],
  turbopack: {},
};

export default nextConfig;
