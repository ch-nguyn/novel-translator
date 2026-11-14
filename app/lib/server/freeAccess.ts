import { pool } from "./db";

// Free use of the app's AI: the admin always has it, and gives it to the
// email addresses they add in the Account tab (see db/free-access.sql).

// Admins: manage the list, and translate free themselves
export const ADMIN_EMAILS = ["cn555444@gmail.com"];

// The longest address RFC 5321 allows
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SessionUser {
  email: string;
  emailVerified: boolean;
}

// Google vouched for the address the account signed in with
export function isAdmin(user: SessionUser): boolean {
  return user.emailVerified && ADMIN_EMAILS.includes(user.email.trim().toLowerCase());
}

// `value` as an email address to store, or null when it is not one
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email) ? email : null;
}

// The user may translate free on the app's AI. Throws when the database fails.
export async function hasFreeAccess(user: SessionUser): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!user.emailVerified) return false;
  const { rows } = await pool.query(`select 1 from "free_access" where "email" = $1`, [user.email.trim().toLowerCase()]);
  return rows.length > 0;
}

export interface FreeAccessEntry {
  email: string;
  // Milliseconds
  addedAt: number;
}

export async function listFreeAccess(): Promise<FreeAccessEntry[]> {
  const { rows } = await pool.query(`select "email", "created_at" from "free_access" order by "created_at" desc`);
  return rows.map((row) => ({ email: row.email, addedAt: new Date(row.created_at).getTime() }));
}

// Adds `email` (normalized); adding it again changes nothing
export async function addFreeAccess(email: string, addedBy: string): Promise<void> {
  await pool.query(`insert into "free_access" ("email", "added_by") values ($1, $2) on conflict ("email") do nothing`, [email, addedBy]);
}

export async function removeFreeAccess(email: string): Promise<void> {
  await pool.query(`delete from "free_access" where "email" = $1`, [email]);
}
