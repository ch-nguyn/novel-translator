import { resolveChapterUrl } from "../../lib/server/fetchContent";
import { responseFor } from "../../lib/server/apiError";
import { limitRequest } from "../../lib/server/rateLimit";

// Turns a novel's page link into its first chapter's link
export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string" || url.length > 2048) {
      return Response.json({ error: "Missing URL" }, { status: 400 });
    }

    const limited = await limitRequest(req, "fetch");
    if (limited) return limited;
    return Response.json({ url: await resolveChapterUrl(url) });
  } catch (e: unknown) {
    return responseFor(e);
  }
}
