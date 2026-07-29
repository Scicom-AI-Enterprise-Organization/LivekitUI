export const ROLES = ['agent', 'customer'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Track names are the contract between this app and the worker.
 *
 * The worker resolves a leg from the publication's **name** first and only falls
 * back to its source, so naming both tracks makes the mapping explicit and
 * survives someone flipping `DUAL_MIC_ROLE` on the worker. An external publisher
 * that uses the same two names works against this sandbox unchanged.
 */
export const AGENT_TRACK = 'agent_audio';
export const CUSTOMER_TRACK = 'customer_audio';

/**
 * Deliberately camelCase and dot-free. `livekit-server-sdk` camelCases the keys
 * of the attribute map when it decodes a `listParticipants` response, so a
 * `lk.`-style `assist.name` goes into the token intact and comes back out of the
 * REST API as `assistName` — and anything reading it again silently never
 * matches. These spellings survive that transform unchanged.
 */
export const AGENT_NAME_ATTRIBUTE = 'assistName';
export const CUSTOMER_NAME_ATTRIBUTE = 'assistCustomerName';

/**
 * Which side a typed line belongs to, stamped on the chat stream itself.
 *
 * The sender's identity cannot say: one participant carries both voices. So the
 * composer says, which is also what makes the worker testable with no phone on
 * the other end — typing as the customer triggers the coaching exactly as a
 * spoken turn would.
 */
export const CHAT_ROLE_ATTRIBUTE = 'assistRole';

export const TRANSCRIPT_TOPIC = 'assist.transcript';
export const SUGGESTION_TOPIC = 'assist.suggestion';

/**
 * Typed messages ride LiveKit's standard chat topic, not one of our own: session
 * capture already records it as a text turn, and the worker reads the same topic.
 */
export const CHAT_TOPIC = 'lk.chat';

export const ROLE_LABEL: Record<Role, string> = {
  agent: 'Support agent',
  customer: 'Customer',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** What the browser needs, handed down from a server component. */
export interface DualConfig {
  serverUrl: string;
  roomName: string;
  /** Empty when the sandbox was created without a worker. */
  agentName: string;
}

/** One line of the conversation. Partials are replaced in place, keyed by `id`. */
export interface TranscriptLine {
  id: string;
  role: Role;
  name: string;
  text: string;
  final: boolean;
  ts: number;
  /**
   * Speech reaches the panel via the worker's transcription; typing reaches it
   * straight off `lk.chat`, so it shows even when no worker is in the room.
   */
  via: 'voice' | 'text';
}

export type SuggestionState = 'thinking' | 'streaming' | 'done' | 'error' | 'superseded';

export interface Suggestion {
  id: string;
  text: string;
  state: SuggestionState;
  ts: number;
}

/** One audio track a publisher has on air, as the room reports it. */
export interface PublishedLeg {
  trackSid: string;
  trackName: string;
  source: string;
  /** Null when the name matches neither role — the worker may still place it by source. */
  role: Role | null;
  muted: boolean;
}

export interface Publisher {
  identity: string;
  name: string;
  legs: PublishedLeg[];
}

export interface RoomState {
  publishers: Publisher[];
  /** Whether the assist worker has joined. */
  workerPresent: boolean;
}

/**
 * The role a track name claims, or null.
 *
 * Mirrors the worker's own first rule (`track_role` in its `agent.py`), including
 * the part that matters: a name containing *both* words claims neither, because a
 * mixed track transcribed as one side is worse than a leg that never appears.
 * The worker's second rule — source, via `DUAL_MIC_ROLE` — is deliberately not
 * mirrored: that setting lives on the worker and this app cannot see it, so a
 * track it cannot name is shown as unlabelled rather than guessed at.
 */
export function roleFromTrackName(trackName: string | undefined | null): Role | null {
  const name = (trackName || '').toLowerCase();
  const matched = ROLES.filter((role) => name.includes(role));
  return matched.length === 1 ? matched[0] : null;
}
