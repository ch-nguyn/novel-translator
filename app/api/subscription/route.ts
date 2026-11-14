import { auth } from "../../lib/server/auth";
import { subscriptionStatus } from "../../lib/server/subscription";
import { hasFreeAccess, isAdmin, usesOwnKey } from "../../lib/server/freeAccess";

// The signed-in user's monthly plan, and how to pay for it
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  const admin = isAdmin(session.user);
  const [status, free, ownKey] = await Promise.all([
    subscriptionStatus(session.user.id),
    hasFreeAccess(session.user),
    admin ? usesOwnKey(session.user.id) : false,
  ]);
  return Response.json({ ...status, free, admin, ownKey }, { headers: { "Cache-Control": "no-store" } });
}
