import { fetchContent, FetchContentError } from "../../lib/server/fetchContent";

export async function POST(req: Request) {
  try {
    const { url, html: providedHtml } = await req.json();

    if (!url || typeof url !== "string") {
      return Response.json({ error: "Missing URL" }, { status: 400 });
    }

    return Response.json(await fetchContent(url, providedHtml));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal server error";
    const status = e instanceof FetchContentError ? e.status : 500;
    return Response.json({ error: message }, { status });
  }
}
