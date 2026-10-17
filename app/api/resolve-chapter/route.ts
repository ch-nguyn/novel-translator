import { resolveChapterUrl, FetchContentError } from "../../lib/server/fetchContent";

// Turns a novel's page link into its first chapter's link
export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string" || url.length > 2048) {
      return Response.json({ error: "Missing URL" }, { status: 400 });
    }

    return Response.json({ url: await resolveChapterUrl(url) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal server error";
    const status = e instanceof FetchContentError ? e.status : 500;
    return Response.json({ error: message }, { status });
  }
}
