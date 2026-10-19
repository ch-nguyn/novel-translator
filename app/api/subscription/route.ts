import { auth } from "../../lib/server/auth";
import { subscriptionStatus } from "../../lib/server/subscription";
import { isAllowListed } from "../../lib/server/aiAccess";

// The signed-in user's monthly plan, and how to pay for it
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  const status = { ...(await subscriptionStatus(session.user.id)), free: isAllowListed(session.user) };
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
