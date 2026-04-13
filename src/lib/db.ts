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
  status: string;
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
  createSandboxApp(name: string, template: string, url: string): Promise<DbSandboxApp>;
  getAllSandboxApps(): Promise<DbSandboxApp[]>;
  deleteSandboxApp(id: number): Promise<void>;
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
          status TEXT NOT NULL DEFAULT 'running',
          created_at TEXT DEFAULT (datetime('now'))
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

    async createSandboxApp(name, template, url) {
      const result = db.prepare(
        "INSERT INTO sandbox_apps (name, template, url) VALUES (?, ?, ?)"
      ).run(name, template, url);
      return db.prepare("SELECT * FROM sandbox_apps WHERE id = ?").get(result.lastInsertRowid) as DbSandboxApp;
    },

    async getAllSandboxApps() {
      return db.prepare("SELECT * FROM sandbox_apps ORDER BY created_at DESC").all() as DbSandboxApp[];
    },

    async deleteSandboxApp(id) {
      db.prepare("DELETE FROM sandbox_apps WHERE id = ?").run(id);
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
          status TEXT NOT NULL DEFAULT 'running',
          created_at TIMESTAMPTZ DEFAULT NOW()
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

    async createSandboxApp(name, template, url) {
      const { rows } = await pool.query(
        "INSERT INTO sandbox_apps (name, template, url) VALUES ($1, $2, $3) RETURNING *",
        [name, template, url]
      );
      return rows[0];
    },

    async getAllSandboxApps() {
      const { rows } = await pool.query("SELECT * FROM sandbox_apps ORDER BY created_at DESC");
      return rows;
    },

    async deleteSandboxApp(id) {
      await pool.query("DELETE FROM sandbox_apps WHERE id = $1", [id]);
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
