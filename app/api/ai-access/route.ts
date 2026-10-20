import { canUseSystemAI, SYSTEM_AI_MODEL } from "../../lib/server/aiAccess";
import { responseFor } from "../../lib/server/apiError";

// Whether the signed-in user's AI calls run on the app's key, so the app
// does not ask them for one. A 503 when that cannot be told: the device then
// keeps what it last heard.
export async function GET(req: Request) {
  try {
    const system = await canUseSystemAI(req.headers);
    return Response.json({ system, model: system ? SYSTEM_AI_MODEL : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return responseFor(e);
  }
}
