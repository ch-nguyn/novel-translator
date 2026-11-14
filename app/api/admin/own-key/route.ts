import { auth } from "../../../lib/server/auth";
import { isAdmin, setUsesOwnKey } from "../../../lib/server/freeAccess";

// The admin chooses what their chapters are translated with: PUT {ownKey: true}
// for their own API key, false for the app's AI
export async function PUT(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!isAdmin(session.user)) return Response.json({ error: "Admins only" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (typeof body?.ownKey !== "boolean") return Response.json({ error: "ownKey must be true or false" }, { status: 400 });
  await setUsesOwnKey(session.user.id, body.ownKey);
  return Response.json({ ownKey: body.ownKey }, { headers: { "Cache-Control": "no-store" } });
}
