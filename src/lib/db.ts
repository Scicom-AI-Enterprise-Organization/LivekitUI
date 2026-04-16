import path from "path";
import fs from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserRole = "owner" | "admin" | "member";

export interface DbUser {
  id: number;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  company: string | null;
  role: UserRole;
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

export interface DbWebhookEvent {
  id: number;
  event: string;
  room: string | null;
  participant: string | null;
  payload: string;
  created_at: string;
}

export interface DbApiKey {
  id: number;
  description: string;
  api_key: string;
  api_secret_hash: string;
  owner: string;
  created_at: string;
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
  updateUserRole(id: number, role: UserRole): Promise<void>;
  deleteUser(id: number): Promise<void>;
  createSession(token: string, userId: number, expiresAt: Date): Promise<void>;
  findSession(token: string): Promise<(DbSession & { user: DbUser }) | null>;
  deleteSession(token: string): Promise<void>;
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
  createApiKey(description: string, apiKey: string, apiSecretHash: string, owner: string): Promise<DbApiKey>;
  getAllApiKeys(): Promise<DbApiKey[]>;
  deleteApiKey(id: number): Promise<void>;
  addWebhookEvent(event: string, room: string | null, participant: string | null, payload: string): Promise<void>;
  getWebhookEvents(limit: number): Promise<DbWebhookEvent[]>;
  clearWebhookEvents(): Promise<void>;
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
          owner TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
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
      `);
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

    async updateUserRole(id, role) {
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
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
          `SELECT s.*, u.id as u_id, u.email, u.password_hash, u.first_name, u.last_name, u.company, u.role, u.created_at as u_created_at
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
          created_at: row.u_created_at as string,
        },
      };
    },

    async deleteSession(token) {
      db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
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

    async createApiKey(description, apiKey, apiSecretHash, owner) {
      const result = db.prepare(
        "INSERT INTO api_keys (description, api_key, api_secret_hash, owner) VALUES (?, ?, ?, ?)"
      ).run(description, apiKey, apiSecretHash, owner);
      return db.prepare("SELECT * FROM api_keys WHERE id = ?").get(result.lastInsertRowid) as DbApiKey;
    },

    async getAllApiKeys() {
      return db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as DbApiKey[];
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
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
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
          owner TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
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
      `);
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

    async updateUserRole(id, role) {
      await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
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
                u.id as u_id, u.email, u.password_hash, u.first_name, u.last_name, u.company, u.role, u.created_at as u_created_at
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
          created_at: row.u_created_at,
        },
      };
    },

    async deleteSession(token) {
      await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
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

    async createApiKey(description, apiKey, apiSecretHash, owner) {
      const { rows } = await pool.query(
        "INSERT INTO api_keys (description, api_key, api_secret_hash, owner) VALUES ($1, $2, $3, $4) RETURNING *",
        [description, apiKey, apiSecretHash, owner]
      );
      return rows[0];
    },

    async getAllApiKeys() {
      const { rows } = await pool.query("SELECT * FROM api_keys ORDER BY created_at DESC");
      return rows;
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
