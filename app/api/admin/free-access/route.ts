import { auth } from "../../../lib/server/auth";
import { addFreeAccess, isAdmin, listFreeAccess, normalizeEmail, removeFreeAccess } from "../../../lib/server/freeAccess";

// The email addresses given free use of the app's AI, for the admin only:
// GET lists them, POST {email} adds one, DELETE {email} removes one.

const NO_STORE = { "Cache-Control": "no-store" };

// The admin's email, or the answer refusing the request
async function admin(req: Request): Promise<string | Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!isAdmin(session.user)) return Response.json({ error: "Admins only" }, { status: 403 });
  return session.user.email;
}

async function emailOf(req: Request): Promise<string | null> {
  const body = await req.json().catch(() => null);
  return normalizeEmail(body?.email);
}

export async function GET(req: Request) {
  const who = await admin(req);
  if (who instanceof Response) return who;
  return Response.json({ entries: await listFreeAccess() }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const who = await admin(req);
  if (who instanceof Response) return who;
  const email = await emailOf(req);
  if (!email) return Response.json({ error: "Not an email address" }, { status: 400 });
  await addFreeAccess(email, who);
  return Response.json({ entries: await listFreeAccess() }, { headers: NO_STORE });
}

export async function DELETE(req: Request) {
  const who = await admin(req);
  if (who instanceof Response) return who;
  const email = await emailOf(req);
  if (!email) return Response.json({ error: "Not an email address" }, { status: 400 });
  await removeFreeAccess(email);
  return Response.json({ entries: await listFreeAccess() }, { headers: NO_STORE });
}
