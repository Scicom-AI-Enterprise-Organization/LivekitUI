/**
 * Serialisers for LiveKit protocol messages.
 *
 * The SDK returns protobuf objects holding bigint timestamps and numeric
 * enums, neither of which survive JSON.stringify usefully. These map them to
 * plain, self-describing JSON for the REST API.
 */

import {
  EgressStatus,
  IngressState_Status,
  SIPCallStatus,
  type EgressInfo,
  type IngressInfo,
  type SIPDispatchRuleInfo,
  type SIPInboundTrunkInfo,
  type SIPOutboundTrunkInfo,
} from "@livekit/protocol";

/** Protobuf timestamps are nanoseconds since the epoch, as a bigint. */
export function nanosToIso(value: bigint | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  // BigInt literals need target >= ES2020, and this project targets ES2017.
  const nanos = typeof value === "bigint" ? value : BigInt(value);
  if (nanos === BigInt(0)) return null;
  return new Date(Number(nanos / BigInt(1e6))).toISOString();
}

export function secondsToIso(value: bigint | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const seconds = typeof value === "bigint" ? Number(value) : value;
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

const egressStatusName = (s: EgressStatus): string =>
  EgressStatus[s]?.replace("EGRESS_", "").toLowerCase() ?? "unknown";

export function serializeEgress(e: EgressInfo) {
  // Exactly one of these request/result fields is set, depending on the kind of
  // egress that was started.
  const request = e.request?.case ?? null;
  const started = nanosToIso(e.startedAt);
  const ended = nanosToIso(e.endedAt);

  return {
    egressId: e.egressId,
    roomId: e.roomId,
    roomName: e.roomName,
    status: egressStatusName(e.status),
    type: request,
    startedAt: started,
    endedAt: ended,
    updatedAt: nanosToIso(e.updatedAt),
    durationSeconds: started && ended
      ? Math.round((Date.parse(ended) - Date.parse(started)) / 1000)
      : null,
    error: e.error || null,
    // Destinations, flattened across the output kinds LiveKit supports.
    destinations: [
      ...e.fileResults.map((f) => ({ kind: "file", location: f.location, size: Number(f.size) })),
      ...e.streamResults.map((s) => ({ kind: "stream", location: s.url, size: null })),
      ...e.segmentResults.map((s) => ({ kind: "segments", location: s.playlistLocation, size: Number(s.size) })),
    ],
  };
}

const ingressStatusName = (s: IngressState_Status | undefined): string =>
  s === undefined ? "unknown" : IngressState_Status[s]?.replace("ENDPOINT_", "").toLowerCase() ?? "unknown";

export function serializeIngress(i: IngressInfo) {
  return {
    ingressId: i.ingressId,
    name: i.name,
    streamKey: i.streamKey,
    url: i.url,
    inputType: i.inputType,
    roomName: i.roomName,
    participantIdentity: i.participantIdentity,
    participantName: i.participantName,
    reusable: i.reusable,
    enabled: i.enabled,
    status: ingressStatusName(i.state?.status),
    startedAt: nanosToIso(i.state?.startedAt),
    endedAt: nanosToIso(i.state?.endedAt),
    error: i.state?.error || null,
    roomId: i.state?.roomId || null,
  };
}

export function serializeInboundTrunk(t: SIPInboundTrunkInfo) {
  return {
    trunkId: t.sipTrunkId,
    direction: "inbound" as const,
    name: t.name,
    metadata: t.metadata || null,
    numbers: t.numbers,
    allowedAddresses: t.allowedAddresses,
    allowedNumbers: t.allowedNumbers,
    authUsername: t.authUsername || null,
    krispEnabled: t.krispEnabled,
  };
}

export function serializeOutboundTrunk(t: SIPOutboundTrunkInfo) {
  return {
    trunkId: t.sipTrunkId,
    direction: "outbound" as const,
    name: t.name,
    metadata: t.metadata || null,
    address: t.address,
    transport: t.transport,
    numbers: t.numbers,
    authUsername: t.authUsername || null,
  };
}

export function serializeDispatchRule(r: SIPDispatchRuleInfo) {
  const rule = r.rule?.rule;
  return {
    ruleId: r.sipDispatchRuleId,
    name: r.name,
    metadata: r.metadata || null,
    trunkIds: r.trunkIds,
    inboundNumbers: r.inboundNumbers,
    hidePhoneNumber: r.hidePhoneNumber,
    // Direct sends every caller into one named room; individual creates a room
    // per caller from a prefix.
    type: rule?.case ?? null,
    roomName: rule?.case === "dispatchRuleDirect" ? rule.value.roomName : null,
    roomPrefix: rule?.case === "dispatchRuleIndividual" ? rule.value.roomPrefix : null,
  };
}

const callStatusName = (s: SIPCallStatus | undefined): string =>
  s === undefined ? "unknown" : SIPCallStatus[s]?.replace("SCS_", "").toLowerCase() ?? "unknown";

export { callStatusName };
