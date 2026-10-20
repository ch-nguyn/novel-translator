import { fetchContent } from "../../lib/server/fetchContent";
import { responseFor } from "../../lib/server/apiError";
import { clientIp, limitRequest } from "../../lib/server/rateLimit";

export async function POST(req: Request) {
  try {
    const { url, html: providedHtml } = await req.json();

    if (!url || typeof url !== "string") {
      return Response.json({ error: "Missing URL" }, { status: 400 });
    }

    const limited = await limitRequest(req, "fetch");
    if (limited) return limited;
    return Response.json(await fetchContent(url, providedHtml, clientIp(req)));
  } catch (e: unknown) {
    return responseFor(e);
  }
}
