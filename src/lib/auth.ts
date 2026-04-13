import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { ensureDb, type UserRole } from "./db";

export interface User {
  id?: number;
  email: string;
  firstName: string;
  lastName: string;
  company?: string;
  role: UserRole;
}

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

export async function getSession(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await ensureDb();
  const session = await db.findSession(token);
  if (!session) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    firstName: session.user.first_name,
    lastName: session.user.last_name,
    company: session.user.company ?? undefined,
    role: session.user.role,
  };
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
    },
  };
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
