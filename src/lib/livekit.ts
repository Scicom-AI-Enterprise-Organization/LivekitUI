import { RoomServiceClient, EgressClient, IngressClient, SipClient, AgentDispatchClient } from "livekit-server-sdk";

function getLivekitUrl(): string {
  const url = process.env.LIVEKIT_URL || "http://localhost:7880";
  return url;
}

function getCredentials() {
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  return { apiKey, apiSecret };
}

export function getRoomServiceClient(): RoomServiceClient {
  const { apiKey, apiSecret } = getCredentials();
  return new RoomServiceClient(getLivekitUrl(), apiKey, apiSecret);
}

export function getEgressClient(): EgressClient {
  const { apiKey, apiSecret } = getCredentials();
  return new EgressClient(getLivekitUrl(), apiKey, apiSecret);
}

export function getIngressClient(): IngressClient {
  const { apiKey, apiSecret } = getCredentials();
  return new IngressClient(getLivekitUrl(), apiKey, apiSecret);
}

export function getSipClient(): SipClient {
  const { apiKey, apiSecret } = getCredentials();
  return new SipClient(getLivekitUrl(), apiKey, apiSecret);
}

export function getAgentDispatchClient(): AgentDispatchClient {
  const { apiKey, apiSecret } = getCredentials();
  return new AgentDispatchClient(getLivekitUrl(), apiKey, apiSecret);
}
