// Whether the signed-in user's AI calls run on the app's key (see
// app/lib/server/aiAccess.ts). Remembered on the device so a chapter resumed
// when the app opens does not wait for the server to say so.

const SYSTEM_AI_KEY = "novel-translator-system-ai";

export function hasSystemAI(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(SYSTEM_AI_KEY) === "1";
}

export function setSystemAI(on: boolean) {
  if (on) localStorage.setItem(SYSTEM_AI_KEY, "1");
  else localStorage.removeItem(SYSTEM_AI_KEY);
}

// Asks the server; keeps the remembered answer when it cannot be reached
export async function refreshSystemAI(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/ai-access", { cache: "no-store", signal });
    if (res.ok) setSystemAI((await res.json()).system === true);
  } catch {
    // offline: keep the last answer
  }
  return hasSystemAI();
}
