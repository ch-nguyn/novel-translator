import { auth } from "../../lib/server/auth";
import { subscriptionStatus } from "../../lib/server/subscription";

// The signed-in user's monthly plan, and how to pay for it
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json(await subscriptionStatus(session.user.id), { headers: { "Cache-Control": "no-store" } });
}
