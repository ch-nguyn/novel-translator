import { ReaderSettings } from "./types";
import { DEVICE_SETTINGS, getSettings, getSettingsSession, getSettingsUpdatedAt, saveSettings, setSettingsSession } from "./storage";

// A signed-in user's settings follow them to every device (app/api/settings).
// Signing in takes the account's settings; after that the latest change
// wins, made on this device or another.

interface RemoteSettings {
  // null for an API key the server could not decrypt
  settings: Record<string, string | number | boolean | null> | null;
  updatedAt: number;
}

export async function pushSettings(settings: ReaderSettings, updatedAt: number): Promise<void> {
  const synced: Record<string, unknown> = { ...settings };
  for (const key of DEVICE_SETTINGS) delete synced[key];
  // keepalive: still sent when the page is closing
  await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: synced, updatedAt }),
    keepalive: true,
  });
}

// Brings this device and the account's stored settings together. `sessionId`
// is the sign-in's. Returns the settings to show when the account's replaced
// this device's, otherwise null.
export async function syncSettings(sessionId: string, signal?: AbortSignal): Promise<ReaderSettings | null> {
  const res = await fetch("/api/settings", { cache: "no-store", signal });
  if (!res.ok) return null;
  const remote: RemoteSettings = await res.json();
  const localUpdatedAt = getSettingsUpdatedAt();
  // Just signed in: the account's settings replace the ones made before
  const signedIn = getSettingsSession() !== sessionId;
  if (remote.settings && (signedIn || remote.updatedAt > localUpdatedAt)) {
    const merged: Record<string, unknown> = { ...getSettings() };
    for (const [key, value] of Object.entries(remote.settings)) {
      if (value !== null && !DEVICE_SETTINGS.includes(key)) merged[key] = value;
    }
    saveSettings(merged as unknown as ReaderSettings, remote.updatedAt);
    setSettingsSession(sessionId);
    return getSettings();
  }
  setSettingsSession(sessionId);
  if (localUpdatedAt > remote.updatedAt) await pushSettings(getSettings(), localUpdatedAt);
  return null;
}
