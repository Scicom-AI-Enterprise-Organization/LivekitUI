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

import { execFileSync } from "node:child_process";

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

/**
 * The commit this tree is at — the fallback for a run with no `APP_VERSION`,
 * which means `npm run dev` or `npm start` from a checkout.
 *
 * Resolved **once per process**: it cannot change while the server is up, and
 * `getRuntimeConfig()` is called on every request that renders the dashboard.
 *
 * This is deliberately not the path a container takes. `.git` is dockerignored,
 * so an image has no repository to ask — CI stamps `APP_VERSION` as a build arg
 * instead (see `.github/workflows/ci.yml`) and this is never reached there.
 */
let localCommit: string | undefined;
function gitCommit(): string {
  if (localCommit === undefined) {
    try {
      localCommit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
        // Inherit nothing: git's own stderr on a non-repo would otherwise land
        // in the server log looking like an application error.
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      // No git, not a repo, or a checkout with no history. "dev" is honest.
      localCommit = "";
    }
  }
  return localCommit || "dev";
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
    // Stamped into the image by CI as `<release>+<commit>`. Falling back to the
    // working tree's commit rather than a literal "dev", so the footer answers
    // "which code is this?" in every way the app runs — the question a version
    // in the sidebar exists to answer at all.
    appVersion:
      process.env.APP_VERSION || process.env.NEXT_PUBLIC_APP_VERSION || gitCommit(),
  };
}
