import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  serverExternalPackages: ["child_process", "net", "better-sqlite3"],
  turbopack: {},
};

export default nextConfig;
