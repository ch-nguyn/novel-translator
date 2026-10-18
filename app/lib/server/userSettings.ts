import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";
import { pool } from "./db";
import { SECRET_SETTINGS } from "../storage";

// A signed-in user's settings, kept so they follow the user to another device.
// The API keys among them are encrypted with a key derived from the server's
// secret; one that cannot be decrypted (the secret changed, or it was written
// by another environment) comes back as null so the device keeps its own.

const MAX_SETTINGS_BYTES = 64 * 1024;

export interface StoredSettings {
  settings: Record<string, string | number | boolean | null>;
  updatedAt: number;
}

function cipherKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "", "novel-translator settings api keys", 32));
}

function encrypt(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decrypt(value: string): string | null {
  if (!value.startsWith("v1:")) return null;
  try {
    const data = Buffer.from(value.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", cipherKey(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Only plain values are kept; anything else in the request is dropped
export function sanitizeSettings(input: unknown): Record<string, string | number | boolean> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const settings: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) settings[key] = value;
  }
  return JSON.stringify(settings).length <= MAX_SETTINGS_BYTES ? settings : null;
}

export async function getUserSettings(userId: string): Promise<StoredSettings | null> {
  const { rows } = await pool.query(`select "settings", "updated_at" from "user_settings" where "user_id" = $1`, [userId]);
  if (rows.length === 0) return null;
  const settings: StoredSettings["settings"] = { ...rows[0].settings };
  for (const key of SECRET_SETTINGS) {
    if (typeof settings[key] === "string" && settings[key]) settings[key] = decrypt(settings[key] as string);
  }
  return { settings, updatedAt: Number(rows[0].updated_at) };
}

// Keeps the settings unless the stored ones were changed later. Returns
// whether they were kept.
export async function putUserSettings(userId: string, settings: Record<string, string | number | boolean>, updatedAt: number): Promise<boolean> {
  const stored: Record<string, string | number | boolean> = { ...settings };
  for (const key of SECRET_SETTINGS) {
    if (typeof stored[key] === "string" && stored[key]) stored[key] = encrypt(stored[key] as string);
  }
  const { rowCount } = await pool.query(
    `insert into "user_settings" ("user_id", "settings", "updated_at") values ($1, $2, $3)
     on conflict ("user_id") do update set "settings" = excluded."settings", "updated_at" = excluded."updated_at"
     where "user_settings"."updated_at" < excluded."updated_at"`,
    [userId, JSON.stringify(stored), updatedAt]
  );
  return (rowCount ?? 0) > 0;
}
