import { NextRequest, NextResponse } from "next/server";
import { SIPTransport } from "@livekit/protocol";
import { getSipClient } from "@/lib/livekit";
import { getSession } from "@/lib/auth";
import { livekitError } from "@/lib/livekit-errors";
import { serializeInboundTrunk, serializeOutboundTrunk } from "@/lib/api-serialize";

const TRANSPORTS: Record<string, SIPTransport> = {
  auto: SIPTransport.SIP_TRANSPORT_AUTO,
  udp: SIPTransport.SIP_TRANSPORT_UDP,
  tcp: SIPTransport.SIP_TRANSPORT_TCP,
  tls: SIPTransport.SIP_TRANSPORT_TLS,
};

function transportFor(value: string | undefined): SIPTransport {
  return TRANSPORTS[(value || "auto").toLowerCase()] ?? SIPTransport.SIP_TRANSPORT_AUTO;
}

/**
 * GET /api/sip-trunks — inbound and outbound SIP trunks in one list.
 * ?direction=inbound|outbound narrows it.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const direction = request.nextUrl.searchParams.get("direction");
  if (direction && direction !== "inbound" && direction !== "outbound") {
    return NextResponse.json(
      { error: 'direction must be "inbound" or "outbound"' },
      { status: 400 }
    );
  }

  try {
    const client = getSipClient();
    const [inbound, outbound] = await Promise.all([
      direction === "outbound" ? Promise.resolve([]) : client.listSipInboundTrunk(),
      direction === "inbound" ? Promise.resolve([]) : client.listSipOutboundTrunk(),
    ]);

    const trunks = [
      ...inbound.map(serializeInboundTrunk),
      ...outbound.map(serializeOutboundTrunk),
    ];
    return NextResponse.json({ trunks, total: trunks.length });
  } catch (error) {
    return livekitError(error, "SIP", "list SIP trunks");
  }
}

/**
 * POST /api/sip-trunks — create a trunk.
 *
 * Inbound:  { direction: "inbound", name, numbers[], allowedAddresses?,
 *             allowedNumbers?, authUsername?, authPassword? }
 * Outbound: { direction: "outbound", name, address, numbers[], transport?,
 *             authUsername?, authPassword? }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: {
    direction?: string;
    name?: string;
    numbers?: string[];
    address?: string;
    allowedAddresses?: string[];
    allowedNumbers?: string[];
    authUsername?: string;
    authPassword?: string;
    metadata?: string;
    transport?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { direction, name, numbers, address, allowedAddresses, allowedNumbers, authUsername, authPassword, metadata } = body;

  if (direction !== "inbound" && direction !== "outbound") {
    return NextResponse.json(
      { error: 'direction must be "inbound" or "outbound"' },
      { status: 400 }
    );
  }
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!numbers?.length) {
    return NextResponse.json({ error: "numbers must be a non-empty array" }, { status: 400 });
  }

  try {
    const client = getSipClient();

    if (direction === "inbound") {
      const trunk = await client.createSipInboundTrunk(name, numbers, {
        allowedAddresses,
        allowedNumbers,
        authUsername,
        authPassword,
        metadata,
      });
      return NextResponse.json(serializeInboundTrunk(trunk));
    }

    if (!address) {
      return NextResponse.json(
        { error: "address is required for an outbound trunk" },
        { status: 400 }
      );
    }
    const trunk = await client.createSipOutboundTrunk(name, address, numbers, {
      // The SDK requires a transport; AUTO lets LiveKit negotiate it.
      transport: transportFor(body.transport),
      authUsername,
      authPassword,
      metadata,
    });
    return NextResponse.json(serializeOutboundTrunk(trunk));
  } catch (error) {
    return livekitError(error, "SIP", "create SIP trunk");
  }
}
