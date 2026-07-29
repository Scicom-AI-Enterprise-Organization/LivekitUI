/**
 * Deployment values the browser needs, resolved from the running container's
 * environment rather than baked into the client bundle.
 *
 * `NEXT_PUBLIC_*` is inlined by `next build`, so a value read that way is
 * frozen at image-build time: overriding it on the deployed container does
 * nothing, and an image built without the right build arg ships a browser
 * bundle that dials `ws://localhost:7880` from a public hostname. Reading these
 * in a server component instead — and handing the result down through
 * `RuntimeConfigProvider` — makes them ordinary runtime env vars.
 *
 * The `NEXT_PUBLIC_*` names are still honoured so existing images keep working;
 * they now take effect at runtime too, since this file is only ever evaluated
 * on the server.
 */

export type RuntimeConfig = {
  /** ws/wss URL the browser dials to reach `livekit-server`. */
  livekitUrl: string;
  /** Region label shown on the console's status rail. Cosmetic. */
  livekitRegion: string;
  /** Origin this dashboard is served from, used to build sandbox links. */
  sandboxDomain: string;
  /** Build identifier shown in the sidebar footer. Cosmetic. */
  appVersion: string;
};

/**
 * The browser cannot use `LIVEKIT_URL`. That one is the server-to-server
 * address — under Docker it is an internal hostname like `http://livekit:7880`,
 * which resolves to nothing from a laptop. So there is deliberately no fallback
 * to it here: a missing public URL degrades to the dev default, not to an
 * address that only the container can reach.
 */
function publicLivekitUrl(): string {
  const raw =
    process.env.LIVEKIT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_LIVEKIT_URL ||
    "ws://localhost:7880";

  // A page served over https cannot open a ws:// socket — the browser blocks it
  // as mixed content before the request is made. Accepting http(s) spellings and
  // normalising them here means one less way to misconfigure a deployment.
  return raw.trim().replace(/^http(s?):\/\//, "ws$1://").replace(/\/$/, "");
}

export function getRuntimeConfig(): RuntimeConfig {
  return {
    livekitUrl: publicLivekitUrl(),
    livekitRegion:
      process.env.LIVEKIT_REGION || process.env.NEXT_PUBLIC_LIVEKIT_REGION || "local",
    sandboxDomain: (
      process.env.SANDBOX_DOMAIN ||
      process.env.NEXT_PUBLIC_SANDBOX_DOMAIN ||
      "http://localhost:3000"
    ).replace(/\/$/, ""),
    // Set per image (`ENV APP_VERSION=<git short sha>` in the Dockerfile, or a
    // compose override). "dev" for an unversioned local run, so the footer is
    // never blank — a missing version reads as a broken footer, not as "nobody
    // stamped this build".
    appVersion:
      process.env.APP_VERSION || process.env.NEXT_PUBLIC_APP_VERSION || "dev",
  };
}
