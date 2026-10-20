import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../lib/server/auth";
import { getUserSettings, putUserSettings, sanitizeSettings } from "../../lib/server/userSettings";
import { sameUser } from "../../lib/server/library";

// The signed-in user's settings: GET returns them ({settings: null} when none
// were saved yet), PUT {settings, updatedAt} saves them unless newer ones are
// stored. Both name the account they are for (LIBRARY_USER_HEADER).

const MAX_CLOCK_AHEAD_MS = 24 * 60 * 60 * 1000;

async function userId(req: NextRequest): Promise<string | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user.id ?? null;
}

export async function GET(req: NextRequest) {
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Asked for another account (this one signed in meanwhile, in another tab)
  if (!sameUser(req, id)) return NextResponse.json({ error: "Signed in as someone else" }, { status: 409 });
  const stored = await getUserSettings(id);
  return NextResponse.json(stored ?? { settings: null, updatedAt: 0 }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Sent for another account (still on its way after this one signed in)
  if (!sameUser(req, id)) return NextResponse.json({ error: "Signed in as someone else" }, { status: 409 });
  const body = await req.json().catch(() => null);
  const settings = sanitizeSettings(body?.settings);
  const updatedAt = body?.updatedAt;
  if (!settings || typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > Date.now() + MAX_CLOCK_AHEAD_MS) {
    return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
  }
  const saved = await putUserSettings(id, settings, updatedAt);
  return NextResponse.json({ saved });
}
