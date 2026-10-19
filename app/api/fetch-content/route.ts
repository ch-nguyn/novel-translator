import { fetchContent, FetchContentError } from "../../lib/server/fetchContent";
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
    const message = e instanceof Error ? e.message : "Internal server error";
    const status = e instanceof FetchContentError ? e.status : 500;
    return Response.json({ error: message }, { status });
  }
}
