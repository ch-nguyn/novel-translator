import { canUseSystemAI, SYSTEM_AI_MODEL } from "../../lib/server/aiAccess";

// Whether the signed-in user's AI calls run on the app's key, so the app
// does not ask them for one
export async function GET(req: Request) {
  const system = await canUseSystemAI(req.headers);
  return Response.json({ system, model: system ? SYSTEM_AI_MODEL : null }, { headers: { "Cache-Control": "no-store" } });
}
