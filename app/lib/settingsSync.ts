import { ReaderSettings } from "./types";
import { LIBRARY_USER_HEADER } from "./librarySync";
import { DEVICE_SETTINGS, getSettings, getSettingsOwner, getSettingsSession, getSettingsUpdatedAt, saveSettings, setSettingsSession } from "./storage";

// A signed-in user's settings follow them to every device (app/api/settings).
// Signing in takes the account's settings; after that the latest change
// wins, made on this device or another. Settings made before signing in
// become the account's when it has none yet; another account's API keys
// never reach this one (claimSettings removes them first).

interface RemoteSettings {
  // null for an API key the server could not decrypt
  settings: Record<string, string | number | boolean | null> | null;
  updatedAt: number;
}

// `userId`: the account they are for; the server refuses them if another is signed in by then
export async function pushSettings(userId: string, settings: ReaderSettings, updatedAt: number): Promise<void> {
  const synced: Record<string, unknown> = { ...settings };
  for (const key of DEVICE_SETTINGS) delete synced[key];
  // keepalive: still sent when the page is closing
  await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", [LIBRARY_USER_HEADER]: userId },
    body: JSON.stringify({ settings: synced, updatedAt }),
    keepalive: true,
  });
}

// Brings this device and the account's stored settings together, once they
// are the account's (claimSettings). `sessionId` is the sign-in's, `userId`
// its account's. Returns the settings to show when the account's replaced
// this device's, otherwise null.
export async function syncSettings(sessionId: string, userId: string, signal?: AbortSignal): Promise<ReaderSettings | null> {
  // The server refuses if another account is signed in by now (the cookie is shared by every tab)
  const res = await fetch("/api/settings", { cache: "no-store", signal, headers: { [LIBRARY_USER_HEADER]: userId } });
  if (!res.ok) return null;
  const remote: RemoteSettings = await res.json();
  // Signed out or into another account (in another tab) while waiting
  if (getSettingsOwner() !== userId) return null;
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
  if (localUpdatedAt > remote.updatedAt) await pushSettings(userId, getSettings(), localUpdatedAt);
  return null;
}
