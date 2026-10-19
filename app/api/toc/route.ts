import { FetchContentError } from "../../lib/server/fetchContent";
import { fetchToc, fetchTocSummary } from "../../lib/server/fetchToc";
import { limitRequest } from "../../lib/server/rateLimit";

// A long novel's list takes a few dozen pages on some sites
export const maxDuration = 60;

// Every reader asking for the same novel within this long gets the same answer
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" };

// ?url=<a chapter or the novel's page> → the novel's table of contents;
// &summary=1 → only how many chapters there are and the newest one
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const url = params.get("url");
  if (!url || url.length > 2048) return Response.json({ error: "Missing URL" }, { status: 400 });
  const limited = await limitRequest(req, "toc");
  if (limited) return limited;
  try {
    const body = params.get("summary") === "1" ? await fetchTocSummary(url) : await fetchToc(url);
    return Response.json(body, { headers: CACHE_HEADERS });
  } catch (e: unknown) {
    const status = e instanceof FetchContentError ? e.status : 502;
    const message = e instanceof Error ? e.message : "Could not load the chapter list";
    console.error(`[toc] ${url}: ${message}`);
    return Response.json({ error: message }, { status });
  }
}
