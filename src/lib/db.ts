import path from "path";
import fs from "fs";
import { DEFAULT_PROVIDERS } from "./providers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserRole = "owner" | "admin" | "member";

/** How the account signs in. Only "local" issues a password we control. */
export type AuthProvider = "local" | "keycloak" | "github";

export interface DbUser {
  id: number;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  company: string | null;
  role: UserRole;
  auth_provider: AuthProvider;
  /** GitHub username for SSO sign-in; null for accounts without GitHub. */
  github_login: string | null;
  created_at: string;
}

export interface DbSession {
  token: string;
  user_id: number;
  expires_at: string;
  created_at: string;
}

export interface DbInvite {
  token: string;
  email: string;
  role: UserRole;
  created_at: string;
  expires_at: string;
  used: number;
}

export type PhoneProvider = "manual" | "twilio" | "vonage" | "telnyx";

export interface DbPhoneNumber {
  id: number;
  number: string;
  label: string | null;
  provider: PhoneProvider;
  provider_sid: string | null;
  capabilities: string; // JSON: { voice: bool, sms: bool }
  created_at: string;
}

export interface DbSandboxApp {
  id: number;
  name: string;
  template: string;
  url: string;
  port: number;
  status: string;
  settings: string; // JSON blob
  created_at: string;
}

export interface DbAgent {
  id: number;
  name: string;
  config: string;  // JSON blob
  status: string;  // 'draft' | 'deployed'
  created_at: string;
  updated_at: string;
}

export interface DbAgentSecret {
  id: number;
  agent_name: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface DbAgentVersion {
  id: number;
  agent_name: string;
  version: number;
  deployer_email: string;
  deployer_name: string;
  created_at: string;
}

/** Project-wide secret. `name` doubles as the env var name in agent code. */
export interface DbSecret {
  id: number;
  name: string;
  value: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** Inference endpoint (OpenAI, Anthropic, or any OpenAI-compatible server). */
export interface DbProvider {
  id: number;
  slug: string;
  name: string;
  plugin: string;
  base_url: string | null;
  api_key_secret: string | null;
  audio_format: string | null;
  models: string; // JSON: ProviderModel[]
  voices: string; // JSON: ProviderVoice[]
  builtin: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderInput {
  slug: string;
  name: string;
  plugin: string;
  baseUrl: string | null;
  apiKeySecret: string | null;
  audioFormat: string | null;
  models: string; // JSON
  voices: string; // JSON
  enabled: boolean;
}

export interface DbWebhookEvent {
  id: number;
  event: string;
  room: string | null;
  participant: string | null;
  payload: string;
  created_at: string;
}

/**
 * A room's lifetime, recorded from `room_started` / `room_finished` webhooks.
 * `ended_at` is null while the room is live.
 */
export interface DbRoomSession {
  room_sid: string;
  room_name: string;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  max_participants: number;
}

/**
 * One participant's stay in a room, from `participant_joined` /
 * `participant_left`. `kind` is LiveKit's own classification (STANDARD, SIP,
 * AGENT, EGRESS, INGRESS); `direction` is set for SIP only.
 */
export interface DbParticipantSession {
  id: number;
  room_sid: string;
  room_name: string;
  identity: string;
  kind: string;
  direction: string | null;
  platform: string | null;
  joined_at: string;
  left_at: string | null;
  duration_sec: number;
}

/** A reading of the server's cumulative byte counters, for the transfer chart. */
export interface DbBandwidthSample {
  id: number;
  rx_bytes: number;
  tx_bytes: number;
  created_at: string;
}

/**
 * A running total accumulated from a counter that resets. `total` is the sum of
 * every rise we have observed; `last_value` is the previous raw reading, kept so
 * the next delta can be computed.
 */
export interface DbMetricCounter {
  name: string;
  total: number;
  last_value: number;
  updated_at: string;
}

export interface DbApiKey {
  id: number;
  description: string;
  api_key: string;
  /** Deprecated — kept for schema compatibility, always written as "". */
  api_secret_hash: string;
  /** Secret encrypted with AES-256-GCM; the gateway needs the plaintext back. */
  api_secret_enc: string | null;
  owner: string;
  created_at: string;
  revoked_at: string | null;
}

/** A reusable tool definition from the Tools library. */
export interface DbAgentTool {
  id: number;
  kind: string;
  name: string;
  description: string;
  config: string; // JSON: HttpTool | ClientTool | McpServer
  created_at: string;
  updated_at: string;
}

/** Bearer token for the REST API. Stored hashed; the value is shown once. */
export interface DbDashboardToken {
  id: number;
  user_id: number;
  name: string;
  /** First few characters, for identifying a token in the UI. */
  token_prefix: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface DbAgentSnapshot {
  id: number;
  sessions: number;
  agents: number;
  created_at: string;
}

export interface DbAgentPerSnapshot {
  id: number;
  agent_name: string;
  sessions: number;
  running: number;
  created_at: string;
}

/**
 * Where session audio is written. `local` is the dashboard's own disk;
 * `s3` is any S3-compatible bucket (AWS, MinIO, R2, Wasabi…).
 */
export type StorageProvider = "local" | "s3";

export interface DbStorageConfig {
  id: number;
  provider: StorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  access_key_id: string;
  /** AES-256-GCM blob; never leaves the server. */
  secret_access_key_enc: string | null;
  force_path_style: number;
  updated_at: string;
}

export interface StorageConfigInput {
  provider: StorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  /** Already encrypted. `null` keeps whatever is stored. */
  secretAccessKeyEnc: string | null;
  forcePathStyle: boolean;
}

/**
 * Server-side session capture, one row (id 1).
 *
 * Off unless someone turns it on: it joins every room the server reports and
 * writes audio to storage, which is not a thing to start doing on its own.
 */
export interface DbCaptureConfig {
  id: number;
  enabled: number;
  capture_audio: number;
  max_minutes: number;
  updated_at: string;
}

export interface CaptureConfigInput {
  enabled: boolean;
  captureAudio: boolean;
  maxMinutes: number;
}

/**
 * A finished console session, kept so it can be replayed later. Everything the
 * live console holds in memory — events, metrics, transcript — is written here
 * when the session ends; the audio lives in object storage and is joined back
 * by room name.
 */
export interface DbConsoleSessionSummary {
  id: number;
  agent_name: string;
  room: string;
  room_sid: string | null;
  /** "browser" or "sip" — how the human side of the call was carried. */
  talk_mode: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  participants: number;
  event_count: number;
  metric_count: number;
  transcript_count: number;
  agent_identity: string | null;
  server_url: string;
  /** "console" — a browser tab hosted it — or "observer" — captured server-side. */
  source: string;
  created_at: string;
}

export interface DbConsoleSession extends DbConsoleSessionSummary {
  /** JSON: AgentConfigView — the model line-up at the time of the call. */
  config: string;
  events: string;
  metrics: string;
  transcript: string;
}

export interface ConsoleSessionInput {
  agentName: string;
  room: string;
  roomSid: string | null;
  talkMode: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  participants: number;
  agentIdentity: string | null;
  serverUrl: string;
  source: string;
  config: string;
  events: string;
  metrics: string;
  transcript: string;
}

export interface DbSessionRecording {
  id: number;
  agent_name: string;
  room: string;
  kind: string;
  /** Identifies the recording within an agent, and names the stored object. */
  file: string;
  storage: string;
  object_key: string;
  mime_type: string;
  bytes: number;
  duration_ms: number;
  started_at: string;
  created_at: string;
}

export interface SessionRecordingInput {
  agentName: string;
  room: string;
  kind: string;
  file: string;
  storage: string;
  objectKey: string;
  mimeType: string;
  bytes: number;
  durationMs: number;
  startedAt: string;
}

export interface Database {
  init(): Promise<void>;
  findUserByEmail(email: string): Promise<DbUser | null>;
  findUserById(id: number): Promise<DbUser | null>;
  createUser(
    email: string,
    passwordHash: string,
    firstName: string,
    lastName: string,
    role: UserRole,
    company?: string
  ): Promise<DbUser>;
  /** Case-insensitive lookup by GitHub username (SSO callback). */
  findUserByGithubLogin(login: string): Promise<DbUser | null>;
  /** Pre-provision a member who signs in only via GitHub SSO (no password). */
  createGithubUser(
    email: string,
    firstName: string,
    lastName: string,
    role: UserRole,
    githubLogin: string
  ): Promise<DbUser>;
  /** Attach a GitHub username to an existing account (first SSO sign-in). */
  linkGithubLogin(id: number, githubLogin: string): Promise<void>;
  /** Replace a placeholder email once GitHub reveals the real verified one. */
  updateUserEmail(id: number, email: string): Promise<void>;
  updateUserRole(id: number, role: UserRole): Promise<void>;
  updateUserPassword(id: number, passwordHash: string): Promise<void>;
  updateUserProfile(id: number, firstName: string, lastName: string, company: string | null): Promise<void>;
  deleteUser(id: number): Promise<void>;
  createSession(token: string, userId: number, expiresAt: Date): Promise<void>;
  findSession(token: string): Promise<(DbSession & { user: DbUser }) | null>;
  deleteSession(token: string): Promise<void>;
  /** Signs every other device out — used after a password change. */
  deleteUserSessionsExcept(userId: number, keepToken: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;
  getAllUsers(): Promise<DbUser[]>;
  createInvite(token: string, email: string, role: UserRole, expiresAt: Date): Promise<void>;
  findInvite(token: string): Promise<DbInvite | null>;
  markInviteUsed(token: string): Promise<void>;
  createPhoneNumber(number: string, label: string | null, provider: PhoneProvider, providerSid: string | null, capabilities: string): Promise<DbPhoneNumber>;
  getAllPhoneNumbers(): Promise<DbPhoneNumber[]>;
  deletePhoneNumber(id: number): Promise<void>;
  findPhoneNumberByNumber(number: string): Promise<DbPhoneNumber | null>;
  createSandboxApp(name: string, template: string, url: string, port: number): Promise<DbSandboxApp>;
  getAllSandboxApps(): Promise<DbSandboxApp[]>;
  getSandboxApp(id: number): Promise<DbSandboxApp | null>;
  updateSandboxAppSettings(id: number, settings: string): Promise<void>;
  updateSandboxAppPort(name: string, port: number): Promise<void>;
  deleteSandboxApp(id: number): Promise<void>;
  addAgentSnapshot(sessions: number, agents: number): Promise<void>;
  getAgentSnapshots(hours: number): Promise<DbAgentSnapshot[]>;
  addAgentPerSnapshot(agentName: string, sessions: number, running: boolean): Promise<void>;
  getAgentPerSnapshots(agentName: string, hours: number): Promise<DbAgentPerSnapshot[]>;
  createApiKey(description: string, apiKey: string, apiSecretEnc: string, owner: string): Promise<DbApiKey>;
  getAllApiKeys(): Promise<DbApiKey[]>;
  findApiKey(apiKey: string): Promise<DbApiKey | null>;
  revokeApiKey(id: number): Promise<void>;
  deleteApiKey(id: number): Promise<void>;
  addWebhookEvent(event: string, room: string | null, participant: string | null, payload: string): Promise<void>;
  getWebhookEvents(limit: number): Promise<DbWebhookEvent[]>;
  clearWebhookEvents(): Promise<void>;
  recordRoomStarted(sid: string, name: string, startedAt: string): Promise<void>;
  recordRoomFinished(sid: string, endedAt: string, durationSec: number): Promise<void>;
  recordParticipantJoined(p: {
    roomSid: string;
    roomName: string;
    identity: string;
    kind: string;
    direction: string | null;
    platform: string | null;
    joinedAt: string;
  }): Promise<void>;
  recordParticipantLeft(roomSid: string, identity: string, leftAt: string, durationSec: number): Promise<void>;
  getRoomSessions(hours: number): Promise<DbRoomSession[]>;
  getParticipantSessions(hours: number): Promise<DbParticipantSession[]>;
  addBandwidthSample(rxBytes: number, txBytes: number): Promise<void>;
  getBandwidthSamples(hours: number): Promise<DbBandwidthSample[]>;
  bumpMetricCounter(name: string, current: number): Promise<void>;
  getMetricCounters(names: string[]): Promise<DbMetricCounter[]>;
  createAgent(name: string, config: string, status: string): Promise<DbAgent>;
  updateAgent(id: number, name: string, config: string, status: string): Promise<void>;
  getAllAgents(): Promise<DbAgent[]>;
  findAgentByName(name: string): Promise<DbAgent | null>;
  deleteAgent(id: number): Promise<void>;
  upsertAgentSecret(agentName: string, key: string, value: string): Promise<void>;
  getAgentSecrets(agentName: string): Promise<DbAgentSecret[]>;
  deleteAgentSecret(agentName: string, key: string): Promise<void>;
  addAgentVersion(agentName: string, deployerEmail: string, deployerName: string): Promise<DbAgentVersion>;
  getAgentVersions(agentName: string): Promise<DbAgentVersion[]>;
  deleteAgentVersions(agentName: string): Promise<void>;
  upsertSecret(name: string, value: string, description: string | null): Promise<void>;
  getAllSecrets(): Promise<DbSecret[]>;
  findSecret(name: string): Promise<DbSecret | null>;
  deleteSecret(name: string): Promise<void>;
  upsertAgentTool(kind: string, name: string, description: string, config: string): Promise<DbAgentTool>;
  getAgentTools(kind?: string): Promise<DbAgentTool[]>;
  findAgentToolById(id: number): Promise<DbAgentTool | null>;
  deleteAgentTool(id: number): Promise<void>;
  createDashboardToken(userId: number, name: string, prefix: string, hash: string): Promise<DbDashboardToken>;
  getDashboardTokens(userId?: number): Promise<(DbDashboardToken & { owner_email: string })[]>;
  findDashboardTokenByHash(hash: string): Promise<(DbDashboardToken & { user: DbUser }) | null>;
  touchDashboardToken(id: number): Promise<void>;
  revokeDashboardToken(id: number): Promise<void>;
  deleteDashboardToken(id: number): Promise<void>;
  findDashboardTokenById(id: number): Promise<DbDashboardToken | null>;
  createProvider(input: ProviderInput): Promise<DbProvider>;
  updateProvider(id: number, input: ProviderInput): Promise<void>;
  getAllProviders(): Promise<DbProvider[]>;
  findProviderBySlug(slug: string): Promise<DbProvider | null>;
  getProvider(id: number): Promise<DbProvider | null>;
  deleteProvider(id: number): Promise<void>;
  getStorageConfig(): Promise<DbStorageConfig | null>;
  saveStorageConfig(input: StorageConfigInput): Promise<void>;
  getCaptureConfig(): Promise<DbCaptureConfig | null>;
  saveCaptureConfig(input: CaptureConfigInput): Promise<void>;
  /** Keyed on the room, so re-saving a session updates it instead of forking. */
  upsertConsoleSession(input: ConsoleSessionInput): Promise<DbConsoleSession>;
  listConsoleSessions(filter: {
    agent?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ sessions: DbConsoleSessionSummary[]; total: number }>;
  getConsoleSession(id: number): Promise<DbConsoleSession | null>;
  findConsoleSessionByRoom(room: string): Promise<DbConsoleSession | null>;
  deleteConsoleSession(id: number): Promise<DbConsoleSessionSummary | null>;
  deleteConsoleSessionsForAgent(agentName: string): Promise<number>;
  getConsoleSessionAgents(): Promise<string[]>;
  addSessionRecording(input: SessionRecordingInput): Promise<DbSessionRecording>;
  getSessionRecordings(agentName: string): Promise<DbSessionRecording[]>;
  getSessionRecordingsForRoom(room: string): Promise<DbSessionRecording[]>;
  findSessionRecording(agentName: string, file: string): Promise<DbSessionRecording | null>;
  /** Returns the row that went away, so its object can be removed from storage. */
  deleteSessionRecording(agentName: string, file: string): Promise<DbSessionRecording | null>;
  deleteSessionRecordingsForAgent(agentName: string): Promise<DbSessionRecording[]>;
  deleteSessionRecordingsForRoom(room: string): Promise<DbSessionRecording[]>;
}

/**
 * Every session column except the three JSON payloads. A list of sessions with
 * their events and metrics inlined would be megabytes; the detail view fetches
 * those one session at a time.
 */
const SESSION_SUMMARY_COLUMNS = `id, agent_name, room, room_sid, talk_mode, started_at,
  ended_at, duration_ms, participants, event_count, metric_count, transcript_count,
  agent_identity, server_url, source, created_at`;

/** Length of a JSON array, without trusting the caller to have counted. */
function countJsonArray(json: string): number {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

function createSqliteDb(): Database {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require("better-sqlite3");
  const dbPath = process.env.SQLITE_PATH || "./data/livekit.db";
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new BetterSqlite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return {
    async init() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          company TEXT,
          role TEXT NOT NULL DEFAULT 'member',
          auth_provider TEXT NOT NULL DEFAULT 'local',
          github_login TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS invites (
          token TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          used INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS phone_numbers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          number TEXT UNIQUE NOT NULL,
          label TEXT,
          provider TEXT NOT NULL DEFAULT 'manual',
          provider_sid TEXT,
          capabilities TEXT NOT NULL DEFAULT '{"voice":true,"sms":false}',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sandbox_apps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          template TEXT NOT NULL,
          url TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'running',
          settings TEXT NOT NULL DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS agent_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sessions INTEGER NOT NULL DEFAULT 0,
          agents INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS agent_per_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT NOT NULL,
          sessions INTEGER NOT NULL DEFAULT 0,
          running INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_agent_per_snapshots_name_time
          ON agent_per_snapshots(agent_name, created_at);
        CREATE TABLE IF NOT EXISTS api_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          description TEXT NOT NULL,
          api_key TEXT UNIQUE NOT NULL,
          api_secret_hash TEXT NOT NULL,
          api_secret_enc TEXT,
          owner TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          revoked_at TEXT
        );
        CREATE TABLE IF NOT EXISTS webhook_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event TEXT NOT NULL,
          room TEXT,
          participant TEXT,
          payload TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS agents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          config TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS agent_secrets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(agent_name, key)
        );
        CREATE TABLE IF NOT EXISTS agent_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT NOT NULL,
          version INTEGER NOT NULL,
          deployer_email TEXT NOT NULL,
          deployer_name TEXT NOT NULL DEFAULT '',
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(agent_name, version)
        );
        CREATE TABLE IF NOT EXISTS secrets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          value TEXT NOT NULL,
          description TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS providers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          plugin TEXT NOT NULL DEFAULT 'openai',
          base_url TEXT,
          api_key_secret TEXT,
          audio_format TEXT,
          models TEXT NOT NULL DEFAULT '[]',
          voices TEXT NOT NULL DEFAULT '[]',
          builtin INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS agent_tools (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          config TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(kind, name)
        );
        -- Bearer tokens for the REST API. Only the SHA-256 of the token is
        -- stored: unlike a LiveKit key we never need the value back, just a
        -- constant-time comparison. Role comes from the owning user at auth
        -- time, so a demotion applies to their tokens immediately.
        CREATE TABLE IF NOT EXISTS dashboard_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          token_prefix TEXT NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          last_used_at TEXT,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_dashboard_tokens_hash ON dashboard_tokens(token_hash);
        -- Where session audio is written. One row, id 1.
        CREATE TABLE IF NOT EXISTS storage_config (
          id INTEGER PRIMARY KEY,
          provider TEXT NOT NULL DEFAULT 'local',
          endpoint TEXT NOT NULL DEFAULT '',
          region TEXT NOT NULL DEFAULT 'us-east-1',
          bucket TEXT NOT NULL DEFAULT '',
          prefix TEXT NOT NULL DEFAULT '',
          access_key_id TEXT NOT NULL DEFAULT '',
          secret_access_key_enc TEXT,
          force_path_style INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT DEFAULT (datetime('now'))
        );
        -- Server-side session capture. One row, id 1, off until switched on in
        -- Settings → Project: it observes every room and writes audio to storage.
        CREATE TABLE IF NOT EXISTS capture_config (
          id INTEGER PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          capture_audio INTEGER NOT NULL DEFAULT 1,
          max_minutes INTEGER NOT NULL DEFAULT 60,
          updated_at TEXT DEFAULT (datetime('now'))
        );
        -- A finished console session, replayable from /sessions/history.
        CREATE TABLE IF NOT EXISTS console_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT NOT NULL,
          room TEXT NOT NULL UNIQUE,
          room_sid TEXT,
          talk_mode TEXT NOT NULL DEFAULT 'browser',
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          participants INTEGER NOT NULL DEFAULT 0,
          event_count INTEGER NOT NULL DEFAULT 0,
          metric_count INTEGER NOT NULL DEFAULT 0,
          transcript_count INTEGER NOT NULL DEFAULT 0,
          agent_identity TEXT,
          server_url TEXT NOT NULL DEFAULT '',
          -- Who wrote the row: "console" (a browser tab hosted the session) or
          -- "observer" (the server-side capture recorded it). Precedence lives
          -- in console-sessions.ts — an observer must not overwrite a console row.
          source TEXT NOT NULL DEFAULT 'console',
          config TEXT NOT NULL DEFAULT '{}',
          events TEXT NOT NULL DEFAULT '[]',
          metrics TEXT NOT NULL DEFAULT '[]',
          transcript TEXT NOT NULL DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_console_sessions_agent
          ON console_sessions(agent_name, started_at);
        -- Audio for a session. The bytes live in storage; this is the index.
        CREATE TABLE IF NOT EXISTS session_recordings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT NOT NULL,
          room TEXT NOT NULL,
          kind TEXT NOT NULL,
          file TEXT NOT NULL,
          storage TEXT NOT NULL DEFAULT 'local',
          object_key TEXT NOT NULL,
          mime_type TEXT NOT NULL DEFAULT 'audio/webm',
          bytes INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          started_at TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(agent_name, file)
        );
        CREATE INDEX IF NOT EXISTS idx_session_recordings_room ON session_recordings(room);
        -- ── Overview analytics ──
        -- LiveKit keeps no history: listRooms() returns only what is live right
        -- now, and webhook_events is trimmed to the last 500 rows. These three
        -- tables are the dashboard's own record, written by the webhook
        -- receiver, so the Overview page can report a time range instead of an
        -- instant.
        CREATE TABLE IF NOT EXISTS room_sessions (
          room_sid TEXT PRIMARY KEY,
          room_name TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_sec INTEGER NOT NULL DEFAULT 0,
          max_participants INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_room_sessions_started ON room_sessions(started_at);
        CREATE TABLE IF NOT EXISTS participant_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_sid TEXT NOT NULL,
          room_name TEXT NOT NULL,
          identity TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'STANDARD',
          direction TEXT,
          platform TEXT,
          joined_at TEXT NOT NULL,
          left_at TEXT,
          duration_sec INTEGER NOT NULL DEFAULT 0,
          UNIQUE(room_sid, identity, joined_at)
        );
        CREATE INDEX IF NOT EXISTS idx_participant_sessions_joined
          ON participant_sessions(joined_at);
        CREATE TABLE IF NOT EXISTS bandwidth_samples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rx_bytes INTEGER NOT NULL DEFAULT 0,
          tx_bytes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_bandwidth_samples_time ON bandwidth_samples(created_at);
        -- Lifetime totals. The server's own counters run from its last boot, so
        -- reading them directly means every restart looks like the traffic never
        -- happened. This accumulates the rise between readings instead, which
        -- survives restarts of both the server and the dashboard.
        CREATE TABLE IF NOT EXISTS metric_counters (
          name TEXT PRIMARY KEY,
          total INTEGER NOT NULL DEFAULT 0,
          last_value INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);

      // ── Migrations for databases created before a column existed ──
      // SQLite has no ADD COLUMN IF NOT EXISTS, so check the table first.
      const userCols = (
        db.prepare("PRAGMA table_info(users)").all() as { name: string }[]
      ).map((c) => c.name);
      if (!userCols.includes("auth_provider")) {
        db.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'");
      }
      if (!userCols.includes("github_login")) {
        db.exec("ALTER TABLE users ADD COLUMN github_login TEXT");
      }

      const apiKeyCols = (
        db.prepare("PRAGMA table_info(api_keys)").all() as { name: string }[]
      ).map((c) => c.name);
      if (!apiKeyCols.includes("api_secret_enc")) {
        db.exec("ALTER TABLE api_keys ADD COLUMN api_secret_enc TEXT");
      }
      if (!apiKeyCols.includes("revoked_at")) {
        db.exec("ALTER TABLE api_keys ADD COLUMN revoked_at TEXT");
      }

      const providerCols = (
        db.prepare("PRAGMA table_info(providers)").all() as { name: string }[]
      ).map((c) => c.name);
      if (!providerCols.includes("audio_format")) {
        db.exec("ALTER TABLE providers ADD COLUMN audio_format TEXT");
      }

      const sessionCols = (
        db.prepare("PRAGMA table_info(console_sessions)").all() as { name: string }[]
      ).map((c) => c.name);
      // Rows that predate server-side capture were all written by a console tab.
      if (!sessionCols.includes("source")) {
        db.exec(
          "ALTER TABLE console_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'console'"
        );
      }

      // Seed the built-in providers once, so a fresh install has a model list.
      const { n } = db.prepare("SELECT COUNT(*) as n FROM providers").get() as { n: number };
      if (n === 0) {
        const insert = db.prepare(
          `INSERT INTO providers (slug, name, plugin, models, voices, builtin, enabled)
           VALUES (?, ?, ?, ?, ?, 1, 1)`
        );
        for (const p of DEFAULT_PROVIDERS) {
          insert.run(p.slug, p.name, p.plugin, JSON.stringify(p.models), JSON.stringify(p.voices || []));
        }
      }
    },

    async findUserByEmail(email) {
      return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as DbUser | null;
    },

    async findUserById(id) {
      return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as DbUser | null;
    },

    async createUser(email, passwordHash, firstName, lastName, role, company) {
      const stmt = db.prepare(
        "INSERT INTO users (email, password_hash, first_name, last_name, role, company) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const result = stmt.run(email, passwordHash, firstName, lastName, role, company || null);
      return db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as DbUser;
    },

    async findUserByGithubLogin(login) {
      return db
        .prepare("SELECT * FROM users WHERE LOWER(github_login) = LOWER(?)")
        .get(login) as DbUser | null;
    },

    async createGithubUser(email, firstName, lastName, role, githubLogin) {
      // Empty password_hash: bcrypt.compare never matches it, so the account
      // cannot sign in with a password — GitHub SSO is the only door.
      const result = db
        .prepare(
          "INSERT INTO users (email, password_hash, first_name, last_name, role, auth_provider, github_login) VALUES (?, '', ?, ?, ?, 'github', ?)"
        )
        .run(email, firstName, lastName, role, githubLogin);
      return db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as DbUser;
    },

    async linkGithubLogin(id, githubLogin) {
      db.prepare("UPDATE users SET github_login = ? WHERE id = ?").run(githubLogin, id);
    },

    async updateUserEmail(id, email) {
      db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, id);
    },

    async updateUserRole(id, role) {
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    },

    async updateUserPassword(id, passwordHash) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
    },

    async updateUserProfile(id, firstName, lastName, company) {
      db.prepare(
        "UPDATE users SET first_name = ?, last_name = ?, company = ? WHERE id = ?"
      ).run(firstName, lastName, company, id);
    },

    async deleteUser(id) {
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
    },

    async createSession(token, userId, expiresAt) {
      db.prepare(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
      ).run(token, userId, expiresAt.toISOString());
    },

    async findSession(token) {
      const row = db
        .prepare(
          `SELECT s.*, u.id as u_id, u.email, u.password_hash, u.first_name, u.last_name, u.company, u.role, u.auth_provider, u.github_login, u.created_at as u_created_at
           FROM sessions s JOIN users u ON s.user_id = u.id
           WHERE s.token = ? AND s.expires_at > datetime('now')`
        )
        .get(token) as Record<string, unknown> | undefined;

      if (!row) return null;

      return {
        token: row.token as string,
        user_id: row.user_id as number,
        expires_at: row.expires_at as string,
        created_at: row.created_at as string,
        user: {
          id: row.u_id as number,
          email: row.email as string,
          password_hash: row.password_hash as string,
          first_name: row.first_name as string,
          last_name: row.last_name as string,
          company: row.company as string | null,
          role: row.role as UserRole,
          auth_provider: (row.auth_provider as AuthProvider) || "local",
          github_login: (row.github_login as string | null) ?? null,
          created_at: row.u_created_at as string,
        },
      };
    },

    async deleteSession(token) {
      db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    },

    async deleteUserSessionsExcept(userId, keepToken) {
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(userId, keepToken);
    },

    async deleteExpiredSessions() {
      db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
    },

    async getAllUsers() {
      return db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as DbUser[];
    },

    async createInvite(token, email, role, expiresAt) {
      db.prepare(
        "INSERT INTO invites (token, email, role, expires_at) VALUES (?, ?, ?, ?)"
      ).run(token, email, role, expiresAt.toISOString());
    },

    async findInvite(token) {
      return db.prepare(
        "SELECT * FROM invites WHERE token = ? AND used = 0 AND expires_at > datetime('now')"
      ).get(token) as DbInvite | null;
    },

    async markInviteUsed(token) {
      db.prepare("UPDATE invites SET used = 1 WHERE token = ?").run(token);
    },

    async createPhoneNumber(number, label, provider, providerSid, capabilities) {
      const result = db.prepare(
        "INSERT INTO phone_numbers (number, label, provider, provider_sid, capabilities) VALUES (?, ?, ?, ?, ?)"
      ).run(number, label, provider, providerSid, capabilities);
      return db.prepare("SELECT * FROM phone_numbers WHERE id = ?").get(result.lastInsertRowid) as DbPhoneNumber;
    },

    async getAllPhoneNumbers() {
      return db.prepare("SELECT * FROM phone_numbers ORDER BY created_at DESC").all() as DbPhoneNumber[];
    },

    async deletePhoneNumber(id) {
      db.prepare("DELETE FROM phone_numbers WHERE id = ?").run(id);
    },

    async findPhoneNumberByNumber(number) {
      return db.prepare("SELECT * FROM phone_numbers WHERE number = ?").get(number) as DbPhoneNumber | null;
    },

    async createSandboxApp(name, template, url, port) {
      const result = db.prepare(
        "INSERT INTO sandbox_apps (name, template, url, port) VALUES (?, ?, ?, ?)"
      ).run(name, template, url, port);
      return db.prepare("SELECT * FROM sandbox_apps WHERE id = ?").get(result.lastInsertRowid) as DbSandboxApp;
    },

    async getAllSandboxApps() {
      return db.prepare("SELECT * FROM sandbox_apps ORDER BY created_at DESC").all() as DbSandboxApp[];
    },

    async getSandboxApp(id) {
      const row = db.prepare("SELECT * FROM sandbox_apps WHERE id = ?").get(id) as DbSandboxApp | undefined;
      return row || null;
    },

    async updateSandboxAppSettings(id, settings) {
      db.prepare("UPDATE sandbox_apps SET settings = ? WHERE id = ?").run(settings, id);
    },

    async updateSandboxAppPort(name, port) {
      db.prepare("UPDATE sandbox_apps SET port = ? WHERE name = ?").run(port, name);
    },

    async deleteSandboxApp(id) {
      db.prepare("DELETE FROM sandbox_apps WHERE id = ?").run(id);
    },

    async addAgentSnapshot(sessions, agents) {
      db.prepare("INSERT INTO agent_snapshots (sessions, agents) VALUES (?, ?)").run(sessions, agents);
      // Clean up snapshots older than 7 days
      db.prepare("DELETE FROM agent_snapshots WHERE created_at < datetime('now', '-7 days')").run();
    },

    async getAgentSnapshots(hours) {
      return db.prepare(
        "SELECT * FROM agent_snapshots WHERE created_at >= datetime('now', '-' || ? || ' hours') ORDER BY created_at ASC"
      ).all(hours) as DbAgentSnapshot[];
    },

    async addAgentPerSnapshot(agentName, sessions, running) {
      db.prepare(
        "INSERT INTO agent_per_snapshots (agent_name, sessions, running) VALUES (?, ?, ?)"
      ).run(agentName, sessions, running ? 1 : 0);
      db.prepare(
        "DELETE FROM agent_per_snapshots WHERE created_at < datetime('now', '-7 days')"
      ).run();
    },

    async getAgentPerSnapshots(agentName, hours) {
      return db.prepare(
        "SELECT * FROM agent_per_snapshots WHERE agent_name = ? AND created_at >= datetime('now', '-' || ? || ' hours') ORDER BY created_at ASC"
      ).all(agentName, hours) as DbAgentPerSnapshot[];
    },

    async createApiKey(description, apiKey, apiSecretEnc, owner) {
      const result = db.prepare(
        "INSERT INTO api_keys (description, api_key, api_secret_hash, api_secret_enc, owner) VALUES (?, ?, '', ?, ?)"
      ).run(description, apiKey, apiSecretEnc, owner);
      return db.prepare("SELECT * FROM api_keys WHERE id = ?").get(result.lastInsertRowid) as DbApiKey;
    },

    async getAllApiKeys() {
      return db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as DbApiKey[];
    },

    async findApiKey(apiKey) {
      return db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(apiKey) as DbApiKey | null;
    },

    async revokeApiKey(id) {
      db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(id);
    },

    async deleteApiKey(id) {
      db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
    },

    async addWebhookEvent(event, room, participant, payload) {
      db.prepare(
        "INSERT INTO webhook_events (event, room, participant, payload) VALUES (?, ?, ?, ?)"
      ).run(event, room, participant, payload);
      db.prepare("DELETE FROM webhook_events WHERE id NOT IN (SELECT id FROM webhook_events ORDER BY created_at DESC LIMIT 500)").run();
    },

    async getWebhookEvents(limit) {
      return db.prepare("SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT ?").all(limit) as DbWebhookEvent[];
    },

    async clearWebhookEvents() {
      db.prepare("DELETE FROM webhook_events").run();
    },

    async recordRoomStarted(sid, name, startedAt) {
      db.prepare(
        `INSERT INTO room_sessions (room_sid, room_name, started_at) VALUES (?, ?, ?)
         ON CONFLICT(room_sid) DO UPDATE SET room_name = excluded.room_name`
      ).run(sid, name, startedAt);
      db.prepare("DELETE FROM room_sessions WHERE started_at < datetime('now', '-60 days')").run();
    },

    async recordRoomFinished(sid, endedAt, durationSec) {
      // A room can finish without us having seen it start (dashboard restarted
      // mid-session). Insert a stub in that case so the session still counts.
      db.prepare(
        `INSERT INTO room_sessions (room_sid, room_name, started_at, ended_at, duration_sec)
         VALUES (?, '', datetime(?, '-' || ? || ' seconds'), ?, ?)
         ON CONFLICT(room_sid) DO UPDATE SET ended_at = excluded.ended_at, duration_sec = excluded.duration_sec`
      ).run(sid, endedAt, Math.round(durationSec), endedAt, Math.round(durationSec));
      db.prepare(
        `UPDATE room_sessions SET max_participants = (
           SELECT COUNT(*) FROM participant_sessions WHERE room_sid = ?
         ) WHERE room_sid = ?`
      ).run(sid, sid);
    },

    async recordParticipantJoined(p) {
      db.prepare(
        `INSERT INTO participant_sessions
           (room_sid, room_name, identity, kind, direction, platform, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(room_sid, identity, joined_at) DO NOTHING`
      ).run(p.roomSid, p.roomName, p.identity, p.kind, p.direction, p.platform, p.joinedAt);
      db.prepare("DELETE FROM participant_sessions WHERE joined_at < datetime('now', '-60 days')").run();
    },

    async recordParticipantLeft(roomSid, identity, leftAt, durationSec) {
      // Close the most recent open stay — an identity can rejoin the same room.
      db.prepare(
        `UPDATE participant_sessions SET left_at = ?, duration_sec = ?
         WHERE id = (
           SELECT id FROM participant_sessions
           WHERE room_sid = ? AND identity = ? AND left_at IS NULL
           ORDER BY joined_at DESC LIMIT 1
         )`
      ).run(leftAt, Math.round(durationSec), roomSid, identity);
    },

    async getRoomSessions(hours) {
      return db.prepare(
        "SELECT * FROM room_sessions WHERE started_at >= datetime('now', '-' || ? || ' hours') ORDER BY started_at ASC"
      ).all(hours) as DbRoomSession[];
    },

    async getParticipantSessions(hours) {
      return db.prepare(
        "SELECT * FROM participant_sessions WHERE joined_at >= datetime('now', '-' || ? || ' hours') ORDER BY joined_at ASC"
      ).all(hours) as DbParticipantSession[];
    },

    async addBandwidthSample(rxBytes, txBytes) {
      // The Overview polls every 10s, but the chart buckets by day — keeping
      // every reading would be ~500k rows over the 60-day window for no extra
      // resolution. One a minute is plenty, and deltas across the sparser
      // samples still account for all the traffic in between.
      db.prepare(
        `INSERT INTO bandwidth_samples (rx_bytes, tx_bytes)
         SELECT ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM bandwidth_samples WHERE created_at > datetime('now', '-55 seconds')
         )`
      ).run(Math.round(rxBytes), Math.round(txBytes));
      db.prepare("DELETE FROM bandwidth_samples WHERE created_at < datetime('now', '-60 days')").run();
    },

    async getBandwidthSamples(hours) {
      return db.prepare(
        "SELECT * FROM bandwidth_samples WHERE created_at >= datetime('now', '-' || ? || ' hours') ORDER BY created_at ASC"
      ).all(hours) as DbBandwidthSample[];
    },

    async bumpMetricCounter(name, current) {
      const value = Math.max(0, Math.round(current));
      // A reading below the last one means the server restarted and its counter
      // went back to zero, so everything it reports now is new traffic. Add the
      // whole reading rather than dropping the interval.
      db.prepare(
        `INSERT INTO metric_counters (name, total, last_value) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           total = total + CASE
             WHEN excluded.last_value >= metric_counters.last_value
               THEN excluded.last_value - metric_counters.last_value
             ELSE excluded.last_value
           END,
           last_value = excluded.last_value,
           updated_at = datetime('now')`
      ).run(name, value, value);
    },

    async getMetricCounters(names) {
      if (names.length === 0) return [];
      const placeholders = names.map(() => "?").join(", ");
      return db
        .prepare(`SELECT * FROM metric_counters WHERE name IN (${placeholders})`)
        .all(...names) as DbMetricCounter[];
    },

    async createAgent(name, config, status) {
      const result = db.prepare(
        "INSERT INTO agents (name, config, status) VALUES (?, ?, ?)"
      ).run(name, config, status);
      return db.prepare("SELECT * FROM agents WHERE id = ?").get(result.lastInsertRowid) as DbAgent;
    },

    async updateAgent(id, name, config, status) {
      db.prepare(
        "UPDATE agents SET name = ?, config = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(name, config, status, id);
    },

    async getAllAgents() {
      return db.prepare("SELECT * FROM agents ORDER BY created_at DESC").all() as DbAgent[];
    },

    async findAgentByName(name) {
      return db.prepare("SELECT * FROM agents WHERE name = ?").get(name) as DbAgent | null;
    },

    async deleteAgent(id) {
      db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    },

    async upsertAgentSecret(agentName, key, value) {
      db.prepare(
        `INSERT INTO agent_secrets (agent_name, key, value) VALUES (?, ?, ?)
         ON CONFLICT(agent_name, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).run(agentName, key, value);
    },

    async getAgentSecrets(agentName) {
      return db.prepare("SELECT * FROM agent_secrets WHERE agent_name = ? ORDER BY created_at ASC").all(agentName) as DbAgentSecret[];
    },

    async deleteAgentSecret(agentName, key) {
      db.prepare("DELETE FROM agent_secrets WHERE agent_name = ? AND key = ?").run(agentName, key);
    },

    async addAgentVersion(agentName, deployerEmail, deployerName) {
      const row = db.prepare(
        "SELECT COALESCE(MAX(version), 0) as max_v FROM agent_versions WHERE agent_name = ?"
      ).get(agentName) as { max_v: number };
      const nextVersion = (row?.max_v || 0) + 1;
      const result = db.prepare(
        "INSERT INTO agent_versions (agent_name, version, deployer_email, deployer_name) VALUES (?, ?, ?, ?)"
      ).run(agentName, nextVersion, deployerEmail, deployerName);
      return db.prepare("SELECT * FROM agent_versions WHERE id = ?").get(result.lastInsertRowid) as DbAgentVersion;
    },

    async getAgentVersions(agentName) {
      return db.prepare(
        "SELECT * FROM agent_versions WHERE agent_name = ? ORDER BY version DESC"
      ).all(agentName) as DbAgentVersion[];
    },

    async deleteAgentVersions(agentName) {
      db.prepare("DELETE FROM agent_versions WHERE agent_name = ?").run(agentName);
    },

    async upsertSecret(name, value, description) {
      db.prepare(
        `INSERT INTO secrets (name, value, description) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           value = excluded.value,
           description = excluded.description,
           updated_at = datetime('now')`
      ).run(name, value, description);
    },

    async getAllSecrets() {
      return db.prepare("SELECT * FROM secrets ORDER BY name ASC").all() as DbSecret[];
    },

    async findSecret(name) {
      const row = db.prepare("SELECT * FROM secrets WHERE name = ?").get(name) as DbSecret | undefined;
      return row || null;
    },

    async deleteSecret(name) {
      db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
    },

    async upsertAgentTool(kind, name, description, config) {
      db.prepare(
        `INSERT INTO agent_tools (kind, name, description, config) VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, name) DO UPDATE SET
           description = excluded.description,
           config = excluded.config,
           updated_at = datetime('now')`
      ).run(kind, name, description, config);
      return db.prepare("SELECT * FROM agent_tools WHERE kind = ? AND name = ?").get(kind, name) as DbAgentTool;
    },

    async getAgentTools(kind) {
      return (kind
        ? db.prepare("SELECT * FROM agent_tools WHERE kind = ? ORDER BY name ASC").all(kind)
        : db.prepare("SELECT * FROM agent_tools ORDER BY kind ASC, name ASC").all()) as DbAgentTool[];
    },

    async findAgentToolById(id) {
      return (db.prepare("SELECT * FROM agent_tools WHERE id = ?").get(id) as DbAgentTool) || null;
    },

    async deleteAgentTool(id) {
      db.prepare("DELETE FROM agent_tools WHERE id = ?").run(id);
    },

    async createDashboardToken(userId, name, prefix, hash) {
      const result = db.prepare(
        "INSERT INTO dashboard_tokens (user_id, name, token_prefix, token_hash) VALUES (?, ?, ?, ?)"
      ).run(userId, name, prefix, hash);
      return db.prepare("SELECT * FROM dashboard_tokens WHERE id = ?").get(result.lastInsertRowid) as DbDashboardToken;
    },

    async getDashboardTokens(userId) {
      const sql = `SELECT t.*, u.email as owner_email FROM dashboard_tokens t
                   JOIN users u ON u.id = t.user_id
                   ${userId ? "WHERE t.user_id = ?" : ""}
                   ORDER BY t.created_at DESC`;
      const stmt = db.prepare(sql);
      return (userId ? stmt.all(userId) : stmt.all()) as (DbDashboardToken & { owner_email: string })[];
    },

    async findDashboardTokenByHash(hash) {
      const row = db.prepare("SELECT * FROM dashboard_tokens WHERE token_hash = ?").get(hash) as DbDashboardToken | undefined;
      if (!row) return null;
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id) as DbUser | undefined;
      if (!user) return null;
      return { ...row, user };
    },

    async findDashboardTokenById(id) {
      const row = db.prepare("SELECT * FROM dashboard_tokens WHERE id = ?").get(id) as DbDashboardToken | undefined;
      return row || null;
    },

    async touchDashboardToken(id) {
      db.prepare("UPDATE dashboard_tokens SET last_used_at = datetime('now') WHERE id = ?").run(id);
    },

    async revokeDashboardToken(id) {
      db.prepare("UPDATE dashboard_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(id);
    },

    async deleteDashboardToken(id) {
      db.prepare("DELETE FROM dashboard_tokens WHERE id = ?").run(id);
    },

    async createProvider(input) {
      const result = db.prepare(
        `INSERT INTO providers (slug, name, plugin, base_url, api_key_secret, audio_format, models, voices, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.slug,
        input.name,
        input.plugin,
        input.baseUrl,
        input.apiKeySecret,
        input.audioFormat,
        input.models,
        input.voices,
        input.enabled ? 1 : 0
      );
      return db.prepare("SELECT * FROM providers WHERE id = ?").get(result.lastInsertRowid) as DbProvider;
    },

    async updateProvider(id, input) {
      db.prepare(
        `UPDATE providers SET slug = ?, name = ?, plugin = ?, base_url = ?, api_key_secret = ?,
           audio_format = ?, models = ?, voices = ?, enabled = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        input.slug,
        input.name,
        input.plugin,
        input.baseUrl,
        input.apiKeySecret,
        input.audioFormat,
        input.models,
        input.voices,
        input.enabled ? 1 : 0,
        id
      );
    },

    async getAllProviders() {
      return db.prepare("SELECT * FROM providers ORDER BY builtin DESC, name ASC").all() as DbProvider[];
    },

    async findProviderBySlug(slug) {
      const row = db.prepare("SELECT * FROM providers WHERE slug = ?").get(slug) as DbProvider | undefined;
      return row || null;
    },

    async getProvider(id) {
      const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as DbProvider | undefined;
      return row || null;
    },

    async deleteProvider(id) {
      db.prepare("DELETE FROM providers WHERE id = ?").run(id);
    },

    // ── Storage ──

    async getStorageConfig() {
      return (db.prepare("SELECT * FROM storage_config WHERE id = 1").get() ??
        null) as DbStorageConfig | null;
    },

    async saveStorageConfig(input) {
      // A null secret means "keep the stored one", so it is only overwritten
      // when the caller actually supplied a new value.
      db.prepare(
        `INSERT INTO storage_config
           (id, provider, endpoint, region, bucket, prefix, access_key_id,
            secret_access_key_enc, force_path_style, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           endpoint = excluded.endpoint,
           region = excluded.region,
           bucket = excluded.bucket,
           prefix = excluded.prefix,
           access_key_id = excluded.access_key_id,
           secret_access_key_enc =
             COALESCE(excluded.secret_access_key_enc, storage_config.secret_access_key_enc),
           force_path_style = excluded.force_path_style,
           updated_at = datetime('now')`
      ).run(
        input.provider,
        input.endpoint,
        input.region,
        input.bucket,
        input.prefix,
        input.accessKeyId,
        input.secretAccessKeyEnc,
        input.forcePathStyle ? 1 : 0
      );
    },

    async getCaptureConfig() {
      return (db.prepare("SELECT * FROM capture_config WHERE id = 1").get() ??
        null) as DbCaptureConfig | null;
    },

    async saveCaptureConfig(input) {
      db.prepare(
        `INSERT INTO capture_config (id, enabled, capture_audio, max_minutes, updated_at)
         VALUES (1, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           enabled = excluded.enabled,
           capture_audio = excluded.capture_audio,
           max_minutes = excluded.max_minutes,
           updated_at = datetime('now')`
      ).run(input.enabled ? 1 : 0, input.captureAudio ? 1 : 0, input.maxMinutes);
    },

    // ── Console session history ──

    async upsertConsoleSession(input) {
      db.prepare(
        `INSERT INTO console_sessions
           (agent_name, room, room_sid, talk_mode, started_at, ended_at, duration_ms,
            participants, event_count, metric_count, transcript_count, agent_identity,
            server_url, source, config, events, metrics, transcript)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(room) DO UPDATE SET
           room_sid = excluded.room_sid,
           talk_mode = excluded.talk_mode,
           -- Refreshed, not preserved: a room name gets reused (the agent-assist
           -- sandbox uses one room per sandbox, SIP rules can funnel every caller
           -- into one), and this row then describes the newest call. Keeping the
           -- first call's start left the row claiming a start hours before its own
           -- audio, which every timeline in the replay is plotted against. For a
           -- repeat write of the *same* session the value is identical anyway.
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           duration_ms = excluded.duration_ms,
           participants = excluded.participants,
           event_count = excluded.event_count,
           metric_count = excluded.metric_count,
           transcript_count = excluded.transcript_count,
           agent_identity = excluded.agent_identity,
           server_url = excluded.server_url,
           source = excluded.source,
           config = excluded.config,
           events = excluded.events,
           metrics = excluded.metrics,
           transcript = excluded.transcript`
      ).run(
        input.agentName,
        input.room,
        input.roomSid,
        input.talkMode,
        input.startedAt,
        input.endedAt,
        input.durationMs,
        input.participants,
        countJsonArray(input.events),
        countJsonArray(input.metrics),
        countJsonArray(input.transcript),
        input.agentIdentity,
        input.serverUrl,
        input.source,
        input.config,
        input.events,
        input.metrics,
        input.transcript
      );

      return db
        .prepare("SELECT * FROM console_sessions WHERE room = ?")
        .get(input.room) as DbConsoleSession;
    },

    async listConsoleSessions({ agent, search, limit, offset }) {
      const where: string[] = [];
      const args: unknown[] = [];
      if (agent) {
        where.push("agent_name = ?");
        args.push(agent);
      }
      if (search) {
        where.push("(room LIKE ? OR agent_name LIKE ? OR transcript LIKE ?)");
        const like = `%${search}%`;
        args.push(like, like, like);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const { n } = db
        .prepare(`SELECT COUNT(*) as n FROM console_sessions ${clause}`)
        .get(...args) as { n: number };

      const sessions = db
        .prepare(
          `SELECT ${SESSION_SUMMARY_COLUMNS} FROM console_sessions ${clause}
           ORDER BY started_at DESC LIMIT ? OFFSET ?`
        )
        .all(...args, limit, offset) as DbConsoleSessionSummary[];

      return { sessions, total: n };
    },

    async getConsoleSession(id) {
      return (db.prepare("SELECT * FROM console_sessions WHERE id = ?").get(id) ??
        null) as DbConsoleSession | null;
    },

    async findConsoleSessionByRoom(room) {
      return (db.prepare("SELECT * FROM console_sessions WHERE room = ?").get(room) ??
        null) as DbConsoleSession | null;
    },

    async deleteConsoleSession(id) {
      const row = db
        .prepare(`SELECT ${SESSION_SUMMARY_COLUMNS} FROM console_sessions WHERE id = ?`)
        .get(id) as DbConsoleSessionSummary | undefined;
      if (!row) return null;
      db.prepare("DELETE FROM console_sessions WHERE id = ?").run(id);
      return row;
    },

    async deleteConsoleSessionsForAgent(agentName) {
      const info = db
        .prepare("DELETE FROM console_sessions WHERE agent_name = ?")
        .run(agentName);
      return info.changes as number;
    },

    async getConsoleSessionAgents() {
      const rows = db
        .prepare("SELECT DISTINCT agent_name FROM console_sessions ORDER BY agent_name")
        .all() as { agent_name: string }[];
      return rows.map((r) => r.agent_name);
    },

    // ── Session recordings ──

    async addSessionRecording(input) {
      db.prepare(
        `INSERT INTO session_recordings
           (agent_name, room, kind, file, storage, object_key, mime_type, bytes,
            duration_ms, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_name, file) DO UPDATE SET
           room = excluded.room,
           kind = excluded.kind,
           storage = excluded.storage,
           object_key = excluded.object_key,
           mime_type = excluded.mime_type,
           bytes = excluded.bytes,
           duration_ms = excluded.duration_ms,
           started_at = excluded.started_at,
           created_at = datetime('now')`
      ).run(
        input.agentName,
        input.room,
        input.kind,
        input.file,
        input.storage,
        input.objectKey,
        input.mimeType,
        input.bytes,
        input.durationMs,
        input.startedAt
      );

      return db
        .prepare("SELECT * FROM session_recordings WHERE agent_name = ? AND file = ?")
        .get(input.agentName, input.file) as DbSessionRecording;
    },

    async getSessionRecordings(agentName) {
      return db
        .prepare(
          "SELECT * FROM session_recordings WHERE agent_name = ? ORDER BY created_at DESC"
        )
        .all(agentName) as DbSessionRecording[];
    },

    async getSessionRecordingsForRoom(room) {
      return db
        .prepare("SELECT * FROM session_recordings WHERE room = ? ORDER BY kind")
        .all(room) as DbSessionRecording[];
    },

    async findSessionRecording(agentName, file) {
      return (db
        .prepare("SELECT * FROM session_recordings WHERE agent_name = ? AND file = ?")
        .get(agentName, file) ?? null) as DbSessionRecording | null;
    },

    async deleteSessionRecording(agentName, file) {
      const row = db
        .prepare("SELECT * FROM session_recordings WHERE agent_name = ? AND file = ?")
        .get(agentName, file) as DbSessionRecording | undefined;
      if (!row) return null;
      db.prepare("DELETE FROM session_recordings WHERE id = ?").run(row.id);
      return row;
    },

    async deleteSessionRecordingsForAgent(agentName) {
      const rows = db
        .prepare("SELECT * FROM session_recordings WHERE agent_name = ?")
        .all(agentName) as DbSessionRecording[];
      db.prepare("DELETE FROM session_recordings WHERE agent_name = ?").run(agentName);
      return rows;
    },

    async deleteSessionRecordingsForRoom(room) {
      const rows = db
        .prepare("SELECT * FROM session_recordings WHERE room = ?")
        .all(room) as DbSessionRecording[];
      db.prepare("DELETE FROM session_recordings WHERE room = ?").run(room);
      return rows;
    },
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

function createPostgresDb(): Database {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg");

  const pool = new Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.POSTGRES_HOST || "localhost",
          port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
          user: process.env.POSTGRES_USER || "livekit",
          password: process.env.POSTGRES_PASSWORD || "",
          database: process.env.POSTGRES_DB || "livekit",
        }
  );

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          company TEXT,
          role TEXT NOT NULL DEFAULT 'member',
          auth_provider TEXT NOT NULL DEFAULT 'local',
          github_login TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS github_login TEXT;
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS invites (
          token TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          used INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS phone_numbers (
          id SERIAL PRIMARY KEY,
          number TEXT UNIQUE NOT NULL,
          label TEXT,
          provider TEXT NOT NULL DEFAULT 'manual',
          provider_sid TEXT,
          capabilities TEXT NOT NULL DEFAULT '{"voice":true,"sms":false}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS sandbox_apps (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          template TEXT NOT NULL,
          url TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'running',
          settings TEXT NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE sandbox_apps ADD COLUMN IF NOT EXISTS settings TEXT NOT NULL DEFAULT '{}';
        CREATE TABLE IF NOT EXISTS agent_snapshots (
          id SERIAL PRIMARY KEY,
          sessions INTEGER NOT NULL DEFAULT 0,
          agents INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS agent_per_snapshots (
          id SERIAL PRIMARY KEY,
          agent_name TEXT NOT NULL,
          sessions INTEGER NOT NULL DEFAULT 0,
          running INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_agent_per_snapshots_name_time
          ON agent_per_snapshots(agent_name, created_at);
        CREATE TABLE IF NOT EXISTS api_keys (
          id SERIAL PRIMARY KEY,
          description TEXT NOT NULL,
          api_key TEXT UNIQUE NOT NULL,
          api_secret_hash TEXT NOT NULL,
          api_secret_enc TEXT,
          owner TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          revoked_at TIMESTAMPTZ
        );
        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS api_secret_enc TEXT;
        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
        CREATE TABLE IF NOT EXISTS webhook_events (
          id SERIAL PRIMARY KEY,
          event TEXT NOT NULL,
          room TEXT,
          participant TEXT,
          payload TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS agents (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          config TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS agent_secrets (
          id SERIAL PRIMARY KEY,
          agent_name TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(agent_name, key)
        );
        CREATE TABLE IF NOT EXISTS agent_versions (
          id SERIAL PRIMARY KEY,
          agent_name TEXT NOT NULL,
          version INTEGER NOT NULL,
          deployer_email TEXT NOT NULL,
          deployer_name TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(agent_name, version)
        );
        CREATE TABLE IF NOT EXISTS secrets (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          value TEXT NOT NULL,
          description TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS providers (
          id SERIAL PRIMARY KEY,
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          plugin TEXT NOT NULL DEFAULT 'openai',
          base_url TEXT,
          api_key_secret TEXT,
          audio_format TEXT,
          models TEXT NOT NULL DEFAULT '[]',
          voices TEXT NOT NULL DEFAULT '[]',
          builtin INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        -- Bearer tokens for the REST API. Only the SHA-256 of the token is
        -- stored: unlike a LiveKit key we never need the value back, just a
        -- constant-time comparison. Role comes from the owning user at auth
        -- time, so a demotion applies to their tokens immediately.
        CREATE TABLE IF NOT EXISTS agent_tools (
          id SERIAL PRIMARY KEY,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          config TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(kind, name)
        );
        CREATE TABLE IF NOT EXISTS dashboard_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          token_prefix TEXT NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_used_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_dashboard_tokens_hash ON dashboard_tokens(token_hash);
        -- Where session audio is written. One row, id 1.
        CREATE TABLE IF NOT EXISTS storage_config (
          id INTEGER PRIMARY KEY,
          provider TEXT NOT NULL DEFAULT 'local',
          endpoint TEXT NOT NULL DEFAULT '',
          region TEXT NOT NULL DEFAULT 'us-east-1',
          bucket TEXT NOT NULL DEFAULT '',
          prefix TEXT NOT NULL DEFAULT '',
          access_key_id TEXT NOT NULL DEFAULT '',
          secret_access_key_enc TEXT,
          force_path_style INTEGER NOT NULL DEFAULT 1,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        -- Server-side session capture. One row, id 1, off until switched on in
        -- Settings → Project: it observes every room and writes audio to storage.
        CREATE TABLE IF NOT EXISTS capture_config (
          id INTEGER PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          capture_audio INTEGER NOT NULL DEFAULT 1,
          max_minutes INTEGER NOT NULL DEFAULT 60,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        -- A finished console session, replayable from /sessions/history.
        CREATE TABLE IF NOT EXISTS console_sessions (
          id SERIAL PRIMARY KEY,
          agent_name TEXT NOT NULL,
          room TEXT NOT NULL UNIQUE,
          room_sid TEXT,
          talk_mode TEXT NOT NULL DEFAULT 'browser',
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          participants INTEGER NOT NULL DEFAULT 0,
          event_count INTEGER NOT NULL DEFAULT 0,
          metric_count INTEGER NOT NULL DEFAULT 0,
          transcript_count INTEGER NOT NULL DEFAULT 0,
          agent_identity TEXT,
          server_url TEXT NOT NULL DEFAULT '',
          -- Who wrote the row: "console" (a browser tab hosted the session) or
          -- "observer" (the server-side capture recorded it). Precedence lives
          -- in console-sessions.ts — an observer must not overwrite a console row.
          source TEXT NOT NULL DEFAULT 'console',
          config TEXT NOT NULL DEFAULT '{}',
          events TEXT NOT NULL DEFAULT '[]',
          metrics TEXT NOT NULL DEFAULT '[]',
          transcript TEXT NOT NULL DEFAULT '[]',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        -- Rows that predate server-side capture were all written by a console tab.
        ALTER TABLE console_sessions
          ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'console';
        CREATE INDEX IF NOT EXISTS idx_console_sessions_agent
          ON console_sessions(agent_name, started_at);
        -- Audio for a session. The bytes live in storage; this is the index.
        CREATE TABLE IF NOT EXISTS session_recordings (
          id SERIAL PRIMARY KEY,
          agent_name TEXT NOT NULL,
          room TEXT NOT NULL,
          kind TEXT NOT NULL,
          file TEXT NOT NULL,
          storage TEXT NOT NULL DEFAULT 'local',
          object_key TEXT NOT NULL,
          mime_type TEXT NOT NULL DEFAULT 'audio/webm',
          bytes INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          started_at TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(agent_name, file)
        );
        CREATE INDEX IF NOT EXISTS idx_session_recordings_room ON session_recordings(room);
        -- ── Overview analytics ──
        -- LiveKit keeps no history: listRooms() returns only what is live right
        -- now, and webhook_events is trimmed to the last 500 rows. These three
        -- tables are the dashboard's own record, written by the webhook
        -- receiver, so the Overview page can report a time range instead of an
        -- instant.
        CREATE TABLE IF NOT EXISTS room_sessions (
          room_sid TEXT PRIMARY KEY,
          room_name TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_sec INTEGER NOT NULL DEFAULT 0,
          max_participants INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_room_sessions_started ON room_sessions(started_at);
        CREATE TABLE IF NOT EXISTS participant_sessions (
          id SERIAL PRIMARY KEY,
          room_sid TEXT NOT NULL,
          room_name TEXT NOT NULL,
          identity TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'STANDARD',
          direction TEXT,
          platform TEXT,
          joined_at TEXT NOT NULL,
          left_at TEXT,
          duration_sec INTEGER NOT NULL DEFAULT 0,
          UNIQUE(room_sid, identity, joined_at)
        );
        CREATE INDEX IF NOT EXISTS idx_participant_sessions_joined
          ON participant_sessions(joined_at);
        CREATE TABLE IF NOT EXISTS bandwidth_samples (
          id SERIAL PRIMARY KEY,
          rx_bytes BIGINT NOT NULL DEFAULT 0,
          tx_bytes BIGINT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_bandwidth_samples_time ON bandwidth_samples(created_at);
        -- Lifetime totals. The server's own counters run from its last boot, so
        -- reading them directly means every restart looks like the traffic never
        -- happened. This accumulates the rise between readings instead, which
        -- survives restarts of both the server and the dashboard.
        CREATE TABLE IF NOT EXISTS metric_counters (
          name TEXT PRIMARY KEY,
          total BIGINT NOT NULL DEFAULT 0,
          last_value BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE providers ADD COLUMN IF NOT EXISTS audio_format TEXT;
      `);

      // Seed the built-in providers once, so a fresh install has a model list.
      const { rows: countRows } = await pool.query("SELECT COUNT(*)::int AS n FROM providers");
      if ((countRows[0]?.n || 0) === 0) {
        for (const p of DEFAULT_PROVIDERS) {
          await pool.query(
            `INSERT INTO providers (slug, name, plugin, models, voices, builtin, enabled)
             VALUES ($1, $2, $3, $4, $5, 1, 1) ON CONFLICT (slug) DO NOTHING`,
            [p.slug, p.name, p.plugin, JSON.stringify(p.models), JSON.stringify(p.voices || [])]
          );
        }
      }
    },

    async findUserByEmail(email) {
      const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      return rows[0] || null;
    },

    async findUserById(id) {
      const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
      return rows[0] || null;
    },

    async createUser(email, passwordHash, firstName, lastName, role, company) {
      const { rows } = await pool.query(
        "INSERT INTO users (email, password_hash, first_name, last_name, role, company) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [email, passwordHash, firstName, lastName, role, company || null]
      );
      return rows[0];
    },

    async findUserByGithubLogin(login) {
      const { rows } = await pool.query(
        "SELECT * FROM users WHERE LOWER(github_login) = LOWER($1)",
        [login]
      );
      return rows[0] || null;
    },

    async createGithubUser(email, firstName, lastName, role, githubLogin) {
      // Empty password_hash: bcrypt.compare never matches it, so the account
      // cannot sign in with a password — GitHub SSO is the only door.
      const { rows } = await pool.query(
        "INSERT INTO users (email, password_hash, first_name, last_name, role, auth_provider, github_login) VALUES ($1, '', $2, $3, $4, 'github', $5) RETURNING *",
        [email, firstName, lastName, role, githubLogin]
      );
      return rows[0];
    },

    async linkGithubLogin(id, githubLogin) {
      await pool.query("UPDATE users SET github_login = $1 WHERE id = $2", [githubLogin, id]);
    },

    async updateUserEmail(id, email) {
      await pool.query("UPDATE users SET email = $1 WHERE id = $2", [email, id]);
    },

    async updateUserRole(id, role) {
      await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
    },

    async updateUserPassword(id, passwordHash) {
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, id]);
    },

    async updateUserProfile(id, firstName, lastName, company) {
      await pool.query(
        "UPDATE users SET first_name = $1, last_name = $2, company = $3 WHERE id = $4",
        [firstName, lastName, company, id]
      );
    },

    async deleteUser(id) {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    },

    async createSession(token, userId, expiresAt) {
      await pool.query(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
        [token, userId, expiresAt.toISOString()]
      );
    },

    async findSession(token) {
      const { rows } = await pool.query(
        `SELECT s.token, s.user_id, s.expires_at, s.created_at,
                u.id as u_id, u.email, u.password_hash, u.first_name, u.last_name, u.company, u.role, u.auth_provider, u.github_login, u.created_at as u_created_at
         FROM sessions s JOIN users u ON s.user_id = u.id
         WHERE s.token = $1 AND s.expires_at > NOW()`,
        [token]
      );

      if (rows.length === 0) return null;
      const row = rows[0];

      return {
        token: row.token,
        user_id: row.user_id,
        expires_at: row.expires_at,
        created_at: row.created_at,
        user: {
          id: row.u_id,
          email: row.email,
          password_hash: row.password_hash,
          first_name: row.first_name,
          last_name: row.last_name,
          company: row.company,
          role: row.role,
          auth_provider: row.auth_provider || "local",
          github_login: row.github_login ?? null,
          created_at: row.u_created_at,
        },
      };
    },

    async deleteSession(token) {
      await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    },

    async deleteUserSessionsExcept(userId, keepToken) {
      await pool.query("DELETE FROM sessions WHERE user_id = $1 AND token <> $2", [userId, keepToken]);
    },

    async deleteExpiredSessions() {
      await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
    },

    async getAllUsers() {
      const { rows } = await pool.query("SELECT * FROM users ORDER BY created_at ASC");
      return rows;
    },

    async createInvite(token, email, role, expiresAt) {
      await pool.query(
        "INSERT INTO invites (token, email, role, expires_at) VALUES ($1, $2, $3, $4)",
        [token, email, role, expiresAt.toISOString()]
      );
    },

    async findInvite(token) {
      const { rows } = await pool.query(
        "SELECT * FROM invites WHERE token = $1 AND used = 0 AND expires_at > NOW()",
        [token]
      );
      return rows[0] || null;
    },

    async markInviteUsed(token) {
      await pool.query("UPDATE invites SET used = 1 WHERE token = $1", [token]);
    },

    async createPhoneNumber(number, label, provider, providerSid, capabilities) {
      const { rows } = await pool.query(
        "INSERT INTO phone_numbers (number, label, provider, provider_sid, capabilities) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [number, label, provider, providerSid, capabilities]
      );
      return rows[0];
    },

    async getAllPhoneNumbers() {
      const { rows } = await pool.query("SELECT * FROM phone_numbers ORDER BY created_at DESC");
      return rows;
    },

    async deletePhoneNumber(id) {
      await pool.query("DELETE FROM phone_numbers WHERE id = $1", [id]);
    },

    async findPhoneNumberByNumber(number) {
      const { rows } = await pool.query("SELECT * FROM phone_numbers WHERE number = $1", [number]);
      return rows[0] || null;
    },

    async createSandboxApp(name, template, url, port) {
      const { rows } = await pool.query(
        "INSERT INTO sandbox_apps (name, template, url, port) VALUES ($1, $2, $3, $4) RETURNING *",
        [name, template, url, port]
      );
      return rows[0];
    },

    async getAllSandboxApps() {
      const { rows } = await pool.query("SELECT * FROM sandbox_apps ORDER BY created_at DESC");
      return rows;
    },

    async getSandboxApp(id) {
      const { rows } = await pool.query("SELECT * FROM sandbox_apps WHERE id = $1", [id]);
      return rows[0] || null;
    },

    async updateSandboxAppSettings(id, settings) {
      await pool.query("UPDATE sandbox_apps SET settings = $1 WHERE id = $2", [settings, id]);
    },

    async updateSandboxAppPort(name, port) {
      await pool.query("UPDATE sandbox_apps SET port = $1 WHERE name = $2", [port, name]);
    },

    async deleteSandboxApp(id) {
      await pool.query("DELETE FROM sandbox_apps WHERE id = $1", [id]);
    },

    async addAgentSnapshot(sessions, agents) {
      await pool.query("INSERT INTO agent_snapshots (sessions, agents) VALUES ($1, $2)", [sessions, agents]);
      await pool.query("DELETE FROM agent_snapshots WHERE created_at < NOW() - INTERVAL '7 days'");
    },

    async getAgentSnapshots(hours) {
      const { rows } = await pool.query(
        "SELECT * FROM agent_snapshots WHERE created_at >= NOW() - make_interval(hours => $1) ORDER BY created_at ASC",
        [hours]
      );
      return rows;
    },

    async addAgentPerSnapshot(agentName, sessions, running) {
      await pool.query(
        "INSERT INTO agent_per_snapshots (agent_name, sessions, running) VALUES ($1, $2, $3)",
        [agentName, sessions, running ? 1 : 0]
      );
      await pool.query("DELETE FROM agent_per_snapshots WHERE created_at < NOW() - INTERVAL '7 days'");
    },

    async getAgentPerSnapshots(agentName, hours) {
      const { rows } = await pool.query(
        "SELECT * FROM agent_per_snapshots WHERE agent_name = $1 AND created_at >= NOW() - make_interval(hours => $2) ORDER BY created_at ASC",
        [agentName, hours]
      );
      return rows;
    },

    async createApiKey(description, apiKey, apiSecretEnc, owner) {
      const { rows } = await pool.query(
        "INSERT INTO api_keys (description, api_key, api_secret_hash, api_secret_enc, owner) VALUES ($1, $2, '', $3, $4) RETURNING *",
        [description, apiKey, apiSecretEnc, owner]
      );
      return rows[0];
    },

    async getAllApiKeys() {
      const { rows } = await pool.query("SELECT * FROM api_keys ORDER BY created_at DESC");
      return rows;
    },

    async findApiKey(apiKey) {
      const { rows } = await pool.query("SELECT * FROM api_keys WHERE api_key = $1", [apiKey]);
      return rows[0] || null;
    },

    async revokeApiKey(id) {
      await pool.query("UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL", [id]);
    },

    async deleteApiKey(id) {
      await pool.query("DELETE FROM api_keys WHERE id = $1", [id]);
    },

    async addWebhookEvent(event, room, participant, payload) {
      await pool.query(
        "INSERT INTO webhook_events (event, room, participant, payload) VALUES ($1, $2, $3, $4)",
        [event, room, participant, payload]
      );
      await pool.query("DELETE FROM webhook_events WHERE id NOT IN (SELECT id FROM webhook_events ORDER BY created_at DESC LIMIT 500)");
    },

    async getWebhookEvents(limit) {
      const { rows } = await pool.query("SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT $1", [limit]);
      return rows;
    },

    async clearWebhookEvents() {
      await pool.query("DELETE FROM webhook_events");
    },

    async recordRoomStarted(sid, name, startedAt) {
      await pool.query(
        `INSERT INTO room_sessions (room_sid, room_name, started_at) VALUES ($1, $2, $3)
         ON CONFLICT (room_sid) DO UPDATE SET room_name = EXCLUDED.room_name`,
        [sid, name, startedAt]
      );
      await pool.query("DELETE FROM room_sessions WHERE started_at < to_char(NOW() - INTERVAL '60 days', 'YYYY-MM-DD HH24:MI:SS')");
    },

    async recordRoomFinished(sid, endedAt, durationSec) {
      // A room can finish without us having seen it start (dashboard restarted
      // mid-session). Insert a stub in that case so the session still counts.
      const seconds = Math.round(durationSec);
      await pool.query(
        `INSERT INTO room_sessions (room_sid, room_name, started_at, ended_at, duration_sec)
         VALUES ($1, '', to_char($2::timestamp - make_interval(secs => $3), 'YYYY-MM-DD HH24:MI:SS'), $2, $3)
         ON CONFLICT (room_sid) DO UPDATE SET ended_at = EXCLUDED.ended_at, duration_sec = EXCLUDED.duration_sec`,
        [sid, endedAt, seconds]
      );
      await pool.query(
        `UPDATE room_sessions SET max_participants = (
           SELECT COUNT(*) FROM participant_sessions WHERE room_sid = $1
         ) WHERE room_sid = $1`,
        [sid]
      );
    },

    async recordParticipantJoined(p) {
      await pool.query(
        `INSERT INTO participant_sessions
           (room_sid, room_name, identity, kind, direction, platform, joined_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (room_sid, identity, joined_at) DO NOTHING`,
        [p.roomSid, p.roomName, p.identity, p.kind, p.direction, p.platform, p.joinedAt]
      );
      await pool.query("DELETE FROM participant_sessions WHERE joined_at < to_char(NOW() - INTERVAL '60 days', 'YYYY-MM-DD HH24:MI:SS')");
    },

    async recordParticipantLeft(roomSid, identity, leftAt, durationSec) {
      // Close the most recent open stay — an identity can rejoin the same room.
      await pool.query(
        `UPDATE participant_sessions SET left_at = $1, duration_sec = $2
         WHERE id = (
           SELECT id FROM participant_sessions
           WHERE room_sid = $3 AND identity = $4 AND left_at IS NULL
           ORDER BY joined_at DESC LIMIT 1
         )`,
        [leftAt, Math.round(durationSec), roomSid, identity]
      );
    },

    async getRoomSessions(hours) {
      const { rows } = await pool.query(
        `SELECT * FROM room_sessions
         WHERE started_at >= to_char(NOW() - make_interval(hours => $1), 'YYYY-MM-DD HH24:MI:SS')
         ORDER BY started_at ASC`,
        [hours]
      );
      return rows;
    },

    async getParticipantSessions(hours) {
      const { rows } = await pool.query(
        `SELECT * FROM participant_sessions
         WHERE joined_at >= to_char(NOW() - make_interval(hours => $1), 'YYYY-MM-DD HH24:MI:SS')
         ORDER BY joined_at ASC`,
        [hours]
      );
      return rows;
    },

    async addBandwidthSample(rxBytes, txBytes) {
      // The Overview polls every 10s, but the chart buckets by day — keeping
      // every reading would be ~500k rows over the 60-day window for no extra
      // resolution. One a minute is plenty, and deltas across the sparser
      // samples still account for all the traffic in between.
      await pool.query(
        `INSERT INTO bandwidth_samples (rx_bytes, tx_bytes)
         SELECT $1::bigint, $2::bigint
         WHERE NOT EXISTS (
           SELECT 1 FROM bandwidth_samples WHERE created_at > NOW() - INTERVAL '55 seconds'
         )`,
        [Math.round(rxBytes), Math.round(txBytes)]
      );
      await pool.query("DELETE FROM bandwidth_samples WHERE created_at < NOW() - INTERVAL '60 days'");
    },

    async getBandwidthSamples(hours) {
      const { rows } = await pool.query(
        "SELECT * FROM bandwidth_samples WHERE created_at >= NOW() - make_interval(hours => $1) ORDER BY created_at ASC",
        [hours]
      );
      // BIGINT comes back as a string from pg; the chart needs numbers.
      return rows.map((r: DbBandwidthSample) => ({
        ...r,
        rx_bytes: Number(r.rx_bytes),
        tx_bytes: Number(r.tx_bytes),
      }));
    },

    async bumpMetricCounter(name, current) {
      const value = Math.max(0, Math.round(current));
      // A reading below the last one means the server restarted and its counter
      // went back to zero, so everything it reports now is new traffic. Add the
      // whole reading rather than dropping the interval.
      await pool.query(
        `INSERT INTO metric_counters (name, total, last_value) VALUES ($1, $2, $2)
         ON CONFLICT (name) DO UPDATE SET
           total = metric_counters.total + CASE
             WHEN EXCLUDED.last_value >= metric_counters.last_value
               THEN EXCLUDED.last_value - metric_counters.last_value
             ELSE EXCLUDED.last_value
           END,
           last_value = EXCLUDED.last_value,
           updated_at = NOW()`,
        [name, value]
      );
    },

    async getMetricCounters(names) {
      if (names.length === 0) return [];
      const { rows } = await pool.query("SELECT * FROM metric_counters WHERE name = ANY($1)", [names]);
      return rows.map((r: DbMetricCounter) => ({
        ...r,
        total: Number(r.total),
        last_value: Number(r.last_value),
      }));
    },

    async createAgent(name, config, status) {
      const { rows } = await pool.query(
        "INSERT INTO agents (name, config, status) VALUES ($1, $2, $3) RETURNING *",
        [name, config, status]
      );
      return rows[0];
    },

    async updateAgent(id, name, config, status) {
      await pool.query(
        "UPDATE agents SET name = $1, config = $2, status = $3, updated_at = NOW() WHERE id = $4",
        [name, config, status, id]
      );
    },

    async getAllAgents() {
      const { rows } = await pool.query("SELECT * FROM agents ORDER BY created_at DESC");
      return rows;
    },

    async findAgentByName(name) {
      const { rows } = await pool.query("SELECT * FROM agents WHERE name = $1", [name]);
      return rows[0] || null;
    },

    async deleteAgent(id) {
      await pool.query("DELETE FROM agents WHERE id = $1", [id]);
    },

    async upsertAgentSecret(agentName, key, value) {
      await pool.query(
        `INSERT INTO agent_secrets (agent_name, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (agent_name, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [agentName, key, value]
      );
    },

    async getAgentSecrets(agentName) {
      const { rows } = await pool.query(
        "SELECT * FROM agent_secrets WHERE agent_name = $1 ORDER BY created_at ASC",
        [agentName]
      );
      return rows;
    },

    async deleteAgentSecret(agentName, key) {
      await pool.query("DELETE FROM agent_secrets WHERE agent_name = $1 AND key = $2", [agentName, key]);
    },

    async addAgentVersion(agentName, deployerEmail, deployerName) {
      const { rows: maxRows } = await pool.query(
        "SELECT COALESCE(MAX(version), 0) AS max_v FROM agent_versions WHERE agent_name = $1",
        [agentName]
      );
      const nextVersion = (maxRows[0]?.max_v || 0) + 1;
      const { rows } = await pool.query(
        "INSERT INTO agent_versions (agent_name, version, deployer_email, deployer_name) VALUES ($1, $2, $3, $4) RETURNING *",
        [agentName, nextVersion, deployerEmail, deployerName]
      );
      return rows[0];
    },

    async getAgentVersions(agentName) {
      const { rows } = await pool.query(
        "SELECT * FROM agent_versions WHERE agent_name = $1 ORDER BY version DESC",
        [agentName]
      );
      return rows;
    },

    async deleteAgentVersions(agentName) {
      await pool.query("DELETE FROM agent_versions WHERE agent_name = $1", [agentName]);
    },

    async upsertSecret(name, value, description) {
      await pool.query(
        `INSERT INTO secrets (name, value, description) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET
           value = EXCLUDED.value,
           description = EXCLUDED.description,
           updated_at = NOW()`,
        [name, value, description]
      );
    },

    async getAllSecrets() {
      const { rows } = await pool.query("SELECT * FROM secrets ORDER BY name ASC");
      return rows;
    },

    async findSecret(name) {
      const { rows } = await pool.query("SELECT * FROM secrets WHERE name = $1", [name]);
      return rows[0] || null;
    },

    async deleteSecret(name) {
      await pool.query("DELETE FROM secrets WHERE name = $1", [name]);
    },

    async upsertAgentTool(kind, name, description, config) {
      const { rows } = await pool.query(
        `INSERT INTO agent_tools (kind, name, description, config) VALUES ($1, $2, $3, $4)
         ON CONFLICT (kind, name) DO UPDATE SET
           description = EXCLUDED.description,
           config = EXCLUDED.config,
           updated_at = NOW()
         RETURNING *`,
        [kind, name, description, config]
      );
      return rows[0];
    },

    async getAgentTools(kind) {
      const { rows } = kind
        ? await pool.query("SELECT * FROM agent_tools WHERE kind = $1 ORDER BY name ASC", [kind])
        : await pool.query("SELECT * FROM agent_tools ORDER BY kind ASC, name ASC");
      return rows;
    },

    async findAgentToolById(id) {
      const { rows } = await pool.query("SELECT * FROM agent_tools WHERE id = $1", [id]);
      return rows[0] || null;
    },

    async deleteAgentTool(id) {
      await pool.query("DELETE FROM agent_tools WHERE id = $1", [id]);
    },

    async createDashboardToken(userId, name, prefix, hash) {
      const { rows } = await pool.query(
        "INSERT INTO dashboard_tokens (user_id, name, token_prefix, token_hash) VALUES ($1, $2, $3, $4) RETURNING *",
        [userId, name, prefix, hash]
      );
      return rows[0];
    },

    async getDashboardTokens(userId) {
      const sql = `SELECT t.*, u.email as owner_email FROM dashboard_tokens t
                   JOIN users u ON u.id = t.user_id
                   ${userId ? "WHERE t.user_id = $1" : ""}
                   ORDER BY t.created_at DESC`;
      const { rows } = await pool.query(sql, userId ? [userId] : []);
      return rows;
    },

    async findDashboardTokenByHash(hash) {
      const { rows } = await pool.query("SELECT * FROM dashboard_tokens WHERE token_hash = $1", [hash]);
      if (!rows[0]) return null;
      const { rows: users } = await pool.query("SELECT * FROM users WHERE id = $1", [rows[0].user_id]);
      if (!users[0]) return null;
      return { ...rows[0], user: users[0] };
    },

    async findDashboardTokenById(id) {
      const { rows } = await pool.query("SELECT * FROM dashboard_tokens WHERE id = $1", [id]);
      return rows[0] || null;
    },

    async touchDashboardToken(id) {
      await pool.query("UPDATE dashboard_tokens SET last_used_at = NOW() WHERE id = $1", [id]);
    },

    async revokeDashboardToken(id) {
      await pool.query("UPDATE dashboard_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL", [id]);
    },

    async deleteDashboardToken(id) {
      await pool.query("DELETE FROM dashboard_tokens WHERE id = $1", [id]);
    },

    async createProvider(input) {
      const { rows } = await pool.query(
        `INSERT INTO providers (slug, name, plugin, base_url, api_key_secret, audio_format, models, voices, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          input.slug,
          input.name,
          input.plugin,
          input.baseUrl,
          input.apiKeySecret,
          input.audioFormat,
          input.models,
          input.voices,
          input.enabled ? 1 : 0,
        ]
      );
      return rows[0];
    },

    async updateProvider(id, input) {
      await pool.query(
        `UPDATE providers SET slug = $1, name = $2, plugin = $3, base_url = $4, api_key_secret = $5,
           audio_format = $6, models = $7, voices = $8, enabled = $9, updated_at = NOW()
         WHERE id = $10`,
        [
          input.slug,
          input.name,
          input.plugin,
          input.baseUrl,
          input.apiKeySecret,
          input.audioFormat,
          input.models,
          input.voices,
          input.enabled ? 1 : 0,
          id,
        ]
      );
    },

    async getAllProviders() {
      const { rows } = await pool.query("SELECT * FROM providers ORDER BY builtin DESC, name ASC");
      return rows;
    },

    async findProviderBySlug(slug) {
      const { rows } = await pool.query("SELECT * FROM providers WHERE slug = $1", [slug]);
      return rows[0] || null;
    },

    async getProvider(id) {
      const { rows } = await pool.query("SELECT * FROM providers WHERE id = $1", [id]);
      return rows[0] || null;
    },

    async deleteProvider(id) {
      await pool.query("DELETE FROM providers WHERE id = $1", [id]);
    },

    // ── Storage ──

    async getStorageConfig() {
      const { rows } = await pool.query("SELECT * FROM storage_config WHERE id = 1");
      return rows[0] || null;
    },

    async saveStorageConfig(input) {
      // A null secret means "keep the stored one", so it is only overwritten
      // when the caller actually supplied a new value.
      await pool.query(
        `INSERT INTO storage_config
           (id, provider, endpoint, region, bucket, prefix, access_key_id,
            secret_access_key_enc, force_path_style, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (id) DO UPDATE SET
           provider = EXCLUDED.provider,
           endpoint = EXCLUDED.endpoint,
           region = EXCLUDED.region,
           bucket = EXCLUDED.bucket,
           prefix = EXCLUDED.prefix,
           access_key_id = EXCLUDED.access_key_id,
           secret_access_key_enc =
             COALESCE(EXCLUDED.secret_access_key_enc, storage_config.secret_access_key_enc),
           force_path_style = EXCLUDED.force_path_style,
           updated_at = NOW()`,
        [
          input.provider,
          input.endpoint,
          input.region,
          input.bucket,
          input.prefix,
          input.accessKeyId,
          input.secretAccessKeyEnc,
          input.forcePathStyle ? 1 : 0,
        ]
      );
    },

    async getCaptureConfig() {
      const { rows } = await pool.query("SELECT * FROM capture_config WHERE id = 1");
      return (rows[0] ?? null) as DbCaptureConfig | null;
    },

    async saveCaptureConfig(input) {
      await pool.query(
        `INSERT INTO capture_config (id, enabled, capture_audio, max_minutes, updated_at)
         VALUES (1, $1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           capture_audio = EXCLUDED.capture_audio,
           max_minutes = EXCLUDED.max_minutes,
           updated_at = NOW()`,
        [input.enabled ? 1 : 0, input.captureAudio ? 1 : 0, input.maxMinutes]
      );
    },

    // ── Console session history ──

    async upsertConsoleSession(input) {
      const { rows } = await pool.query(
        `INSERT INTO console_sessions
           (agent_name, room, room_sid, talk_mode, started_at, ended_at, duration_ms,
            participants, event_count, metric_count, transcript_count, agent_identity,
            server_url, source, config, events, metrics, transcript)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (room) DO UPDATE SET
           room_sid = EXCLUDED.room_sid,
           talk_mode = EXCLUDED.talk_mode,
           -- See the SQLite half: a reused room name means this row describes the
           -- newest call, so its start has to move with it.
           started_at = EXCLUDED.started_at,
           ended_at = EXCLUDED.ended_at,
           duration_ms = EXCLUDED.duration_ms,
           participants = EXCLUDED.participants,
           event_count = EXCLUDED.event_count,
           metric_count = EXCLUDED.metric_count,
           transcript_count = EXCLUDED.transcript_count,
           agent_identity = EXCLUDED.agent_identity,
           server_url = EXCLUDED.server_url,
           source = EXCLUDED.source,
           config = EXCLUDED.config,
           events = EXCLUDED.events,
           metrics = EXCLUDED.metrics,
           transcript = EXCLUDED.transcript
         RETURNING *`,
        [
          input.agentName,
          input.room,
          input.roomSid,
          input.talkMode,
          input.startedAt,
          input.endedAt,
          input.durationMs,
          input.participants,
          countJsonArray(input.events),
          countJsonArray(input.metrics),
          countJsonArray(input.transcript),
          input.agentIdentity,
          input.serverUrl,
          input.source,
          input.config,
          input.events,
          input.metrics,
          input.transcript,
        ]
      );
      return rows[0];
    },

    async listConsoleSessions({ agent, search, limit, offset }) {
      const where: string[] = [];
      const args: unknown[] = [];
      if (agent) {
        args.push(agent);
        where.push(`agent_name = $${args.length}`);
      }
      if (search) {
        args.push(`%${search}%`);
        const n = args.length;
        where.push(`(room ILIKE $${n} OR agent_name ILIKE $${n} OR transcript ILIKE $${n})`);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM console_sessions ${clause}`,
        args
      );
      const { rows } = await pool.query(
        `SELECT ${SESSION_SUMMARY_COLUMNS} FROM console_sessions ${clause}
         ORDER BY started_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, limit, offset]
      );

      return { sessions: rows, total: countRows[0]?.n || 0 };
    },

    async getConsoleSession(id) {
      const { rows } = await pool.query("SELECT * FROM console_sessions WHERE id = $1", [id]);
      return rows[0] || null;
    },

    async findConsoleSessionByRoom(room) {
      const { rows } = await pool.query("SELECT * FROM console_sessions WHERE room = $1", [room]);
      return rows[0] || null;
    },

    async deleteConsoleSession(id) {
      const { rows } = await pool.query(
        `DELETE FROM console_sessions WHERE id = $1 RETURNING ${SESSION_SUMMARY_COLUMNS}`,
        [id]
      );
      return rows[0] || null;
    },

    async deleteConsoleSessionsForAgent(agentName) {
      const result = await pool.query("DELETE FROM console_sessions WHERE agent_name = $1", [
        agentName,
      ]);
      return result.rowCount || 0;
    },

    async getConsoleSessionAgents() {
      const { rows } = await pool.query(
        "SELECT DISTINCT agent_name FROM console_sessions ORDER BY agent_name"
      );
      return rows.map((r: { agent_name: string }) => r.agent_name);
    },

    // ── Session recordings ──

    async addSessionRecording(input) {
      const { rows } = await pool.query(
        `INSERT INTO session_recordings
           (agent_name, room, kind, file, storage, object_key, mime_type, bytes,
            duration_ms, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (agent_name, file) DO UPDATE SET
           room = EXCLUDED.room,
           kind = EXCLUDED.kind,
           storage = EXCLUDED.storage,
           object_key = EXCLUDED.object_key,
           mime_type = EXCLUDED.mime_type,
           bytes = EXCLUDED.bytes,
           duration_ms = EXCLUDED.duration_ms,
           started_at = EXCLUDED.started_at,
           created_at = NOW()
         RETURNING *`,
        [
          input.agentName,
          input.room,
          input.kind,
          input.file,
          input.storage,
          input.objectKey,
          input.mimeType,
          input.bytes,
          input.durationMs,
          input.startedAt,
        ]
      );
      return rows[0];
    },

    async getSessionRecordings(agentName) {
      const { rows } = await pool.query(
        "SELECT * FROM session_recordings WHERE agent_name = $1 ORDER BY created_at DESC",
        [agentName]
      );
      return rows;
    },

    async getSessionRecordingsForRoom(room) {
      const { rows } = await pool.query(
        "SELECT * FROM session_recordings WHERE room = $1 ORDER BY kind",
        [room]
      );
      return rows;
    },

    async findSessionRecording(agentName, file) {
      const { rows } = await pool.query(
        "SELECT * FROM session_recordings WHERE agent_name = $1 AND file = $2",
        [agentName, file]
      );
      return rows[0] || null;
    },

    async deleteSessionRecording(agentName, file) {
      const { rows } = await pool.query(
        "DELETE FROM session_recordings WHERE agent_name = $1 AND file = $2 RETURNING *",
        [agentName, file]
      );
      return rows[0] || null;
    },

    async deleteSessionRecordingsForAgent(agentName) {
      const { rows } = await pool.query(
        "DELETE FROM session_recordings WHERE agent_name = $1 RETURNING *",
        [agentName]
      );
      return rows;
    },

    async deleteSessionRecordingsForRoom(room) {
      const { rows } = await pool.query(
        "DELETE FROM session_recordings WHERE room = $1 RETURNING *",
        [room]
      );
      return rows;
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _db: Database | null = null;
let _initPromise: Promise<void> | null = null;

export function getDb(): Database {
  if (!_db) {
    const dbType = (process.env.DB_TYPE || "sqlite").toLowerCase();
    _db = dbType === "postgres" ? createPostgresDb() : createSqliteDb();
    _initPromise = _db.init();
  }
  return _db;
}

export async function ensureDb(): Promise<Database> {
  const db = getDb();
  if (_initPromise) {
    await _initPromise;
    _initPromise = null;
  }
  return db;
}
