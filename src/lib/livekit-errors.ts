import { NextResponse } from "next/server";

/**
 * Turns a LiveKit server-API failure into a useful HTTP response.
 *
 * Egress, ingress, and SIP are separate LiveKit services that register over
 * Redis. A single-node `livekit-server --dev` has neither, and answers with
 * "egress not connected (redis required)". That is a deployment gap rather
 * than a bug, so it gets its own 503 and a `serviceAvailable: false` flag the
 * UI can key off to explain itself instead of showing a red error.
 */
export function livekitError(error: unknown, service: string, action: string) {
  const details = String(error);

  if (/not connected|redis required/i.test(details)) {
    return NextResponse.json(
      {
        error: `The ${service} service is not available on this LiveKit deployment`,
        reason:
          `LiveKit reports "${service} not connected". This service runs as its own process ` +
          `and registers with the server over Redis — configure Redis and run the ${service} ` +
          `service to use it.`,
        serviceAvailable: false,
        details,
      },
      { status: 503 }
    );
  }

  if (/not found|does not exist/i.test(details)) {
    return NextResponse.json({ error: `Not found`, details }, { status: 404 });
  }

  return NextResponse.json({ error: `Failed to ${action}`, details }, { status: 502 });
}
