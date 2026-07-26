import { cookies, headers } from "next/headers";
import bcrypt from "bcryptjs";
import { ensureDb, type AuthProvider, type DbUser, type UserRole } from "./db";
import { bearerFromHeader, hashApiToken } from "./api-tokens";

export interface User {
  id?: number;
  email: string;
  firstName: string;
  lastName: string;
  company?: string;
  role: UserRole;
  /** "local" accounts have a password here; anything else is managed by an IdP. */
  authProvider?: AuthProvider;
  createdAt?: string;
}

/** Minimum length enforced on any password we store ourselves. */
export const MIN_PASSWORD_LENGTH = 8;

const SESSION_COOKIE = "lk_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(user: User): Promise<string> {
  const db = await ensureDb();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

  await db.createSession(token, user.id!, expiresAt);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return token;
}

function toUser(row: DbUser): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    company: row.company ?? undefined,
    role: row.role,
    authProvider: row.auth_provider ?? "local",
    createdAt: row.created_at,
  };
}

/**
 * Resolves the caller from an `Authorization: Bearer lkui_…` header.
 * The role is read from the owning user, so revoking or demoting them takes
 * effect on their tokens immediately.
 */
async function getBearerUser(): Promise<User | null> {
  const headerStore = await headers();
  const token = bearerFromHeader(headerStore.get("authorization"));
  if (!token) return null;

  const db = await ensureDb();
  const row = await db.findDashboardTokenByHash(hashApiToken(token));
  if (!row || row.revoked_at) return null;

  // Best-effort: a failed timestamp write must not fail the request.
  try {
    await db.touchDashboardToken(row.id);
  } catch {}

  return toUser(row.user);
}

/**
 * The caller, whether they came from the browser (session cookie) or a script
 * (Bearer token). Every route that calls this accepts both automatically.
 */
export async function getSession(): Promise<User | null> {
  const bearer = await getBearerUser();
  if (bearer) return bearer;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await ensureDb();
  const session = await db.findSession(token);
  if (!session) return null;

  return toUser(session.user);
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await ensureDb();
    await db.deleteSession(token);
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function registerUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  company?: string
): Promise<{ success: boolean; error?: string; user?: User }> {
  const db = await ensureDb();

  const existing = await db.findUserByEmail(email);
  if (existing) {
    return { success: false, error: "An account with this email already exists" };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  // Signup always creates an owner
  const dbUser = await db.createUser(email, passwordHash, firstName, lastName, "owner", company);

  return {
    success: true,
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.first_name,
      lastName: dbUser.last_name,
      company: dbUser.company ?? undefined,
      role: dbUser.role,
      authProvider: dbUser.auth_provider ?? "local",
    },
  };
}

export async function createInvite(
  email: string,
  role: UserRole
): Promise<{ success: boolean; error?: string; token?: string }> {
  const db = await ensureDb();

  const existing = await db.findUserByEmail(email);
  if (existing) {
    return { success: false, error: "A user with this email already exists" };
  }

  if (role === "owner") {
    return { success: false, error: "Cannot invite a user as owner" };
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await db.createInvite(token, email, role, expiresAt);

  return { success: true, token };
}

export async function registerWithInvite(
  inviteToken: string,
  password: string,
  firstName: string,
  lastName: string,
  company?: string
): Promise<{ success: boolean; error?: string; user?: User }> {
  const db = await ensureDb();

  const invite = await db.findInvite(inviteToken);
  if (!invite) {
    return { success: false, error: "Invalid or expired invite link" };
  }

  const existing = await db.findUserByEmail(invite.email);
  if (existing) {
    return { success: false, error: "An account with this email already exists" };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const dbUser = await db.createUser(
    invite.email,
    passwordHash,
    firstName,
    lastName,
    invite.role,
    company
  );

  await db.markInviteUsed(inviteToken);

  return {
    success: true,
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.first_name,
      lastName: dbUser.last_name,
      company: dbUser.company ?? undefined,
      role: dbUser.role,
      authProvider: dbUser.auth_provider ?? "local",
    },
  };
}

export async function validateCredentials(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; user?: User }> {
  const db = await ensureDb();

  const dbUser = await db.findUserByEmail(email);
  if (!dbUser) {
    return { success: false, error: "Invalid email or password" };
  }

  const valid = await bcrypt.compare(password, dbUser.password_hash);
  if (!valid) {
    return { success: false, error: "Invalid email or password" };
  }

  return {
    success: true,
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.first_name,
      lastName: dbUser.last_name,
      company: dbUser.company ?? undefined,
      role: dbUser.role,
      authProvider: dbUser.auth_provider ?? "local",
    },
  };
}

/**
 * Change the password of a local account. Requires the current password, and
 * signs every other session out so a leaked cookie stops working.
 */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const db = await ensureDb();

  const dbUser = await db.findUserById(userId);
  if (!dbUser) {
    return { success: false, error: "Account not found" };
  }

  const provider = dbUser.auth_provider ?? "local";
  if (provider !== "local") {
    return {
      success: false,
      error: `This account signs in with ${provider}. Change the password with that provider instead.`,
    };
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      success: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }

  const valid = await bcrypt.compare(currentPassword, dbUser.password_hash);
  if (!valid) {
    return { success: false, error: "Current password is incorrect" };
  }

  if (await bcrypt.compare(newPassword, dbUser.password_hash)) {
    return { success: false, error: "New password must be different from the current one" };
  }

  await db.updateUserPassword(userId, await bcrypt.hash(newPassword, 10));

  // Keep this tab signed in, drop everything else.
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.deleteUserSessionsExcept(userId, token);
  }

  return { success: true };
}

/** Update the signed-in user's own name / company. */
export async function updateProfile(
  userId: number,
  firstName: string,
  lastName: string,
  company: string | null
): Promise<{ success: boolean; error?: string }> {
  if (!firstName.trim() || !lastName.trim()) {
    return { success: false, error: "First and last name are required" };
  }

  const db = await ensureDb();
  await db.updateUserProfile(userId, firstName.trim(), lastName.trim(), company?.trim() || null);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Role checks
// ---------------------------------------------------------------------------

export function canManageMembers(role: UserRole): boolean {
  return role === "owner";
}

export function canManageSettings(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

export function canManageResources(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

export function canDeleteProject(role: UserRole): boolean {
  return role === "owner";
}
