export const ROLES = ['agent', 'customer'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Deliberately camelCase and dot-free. `livekit-server-sdk` camelCases the keys
 * of the attribute map when it decodes a `listParticipants` response, so a
 * `lk.`-style `assist.role` goes into the token intact and comes back out of the
 * REST API as `assistRole` — and the seat check silently never matches. These
 * spellings survive that transform unchanged.
 */
export const ROLE_ATTRIBUTE = 'assistRole';
export const NAME_ATTRIBUTE = 'assistName';

export const TRANSCRIPT_TOPIC = 'assist.transcript';
export const SUGGESTION_TOPIC = 'assist.suggestion';

/**
 * Typed messages ride LiveKit's standard chat topic, not a topic of our own: the
 * dashboard's session capture already records it as a text turn, and every client
 * renders it directly, so typing works with no worker in the room. The worker
 * reads the same topic to coach on typed turns.
 */
export const CHAT_TOPIC = 'lk.chat';

export const ROLE_LABEL: Record<Role, string> = {
  agent: 'Support agent',
  customer: 'Customer',
};

export function otherRole(role: Role): Role {
  return role === 'agent' ? 'customer' : 'agent';
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** What the browser needs, handed down from a server component. */
export interface AssistConfig {
  serverUrl: string;
  roomName: string;
  /** Empty when the sandbox was created without an assist worker. */
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

export interface Seat {
  role: Role;
  name: string;
  identity: string;
}

export interface RoomState {
  /** Humans in the room right now, by role. */
  seats: Seat[];
  /** Whether the assist worker has joined. */
  workerPresent: boolean;
}
