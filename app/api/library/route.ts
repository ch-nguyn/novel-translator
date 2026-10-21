import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../lib/server/auth";
import { getLibrary, MAX_NOVELS_PER_REQUEST, putNovels, readJson, sameUser, sanitizeNovel, ShelfNovel } from "../../lib/server/library";

// The signed-in user's bookshelf (app/lib/librarySync.ts): GET returns its
// novels and when each novel's names last changed; PUT {novels} saves the
// novels that win over the stored ones (further along, see replacesPlace).

async function userId(req: NextRequest): Promise<string | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user.id ?? null;
}

export async function GET(req: NextRequest) {
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!sameUser(req, id)) return NextResponse.json({ error: "Signed in as someone else" }, { status: 409 });
  return NextResponse.json(await getLibrary(id), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!sameUser(req, id)) return NextResponse.json({ error: "Signed in as someone else" }, { status: 409 });
  const body = (await readJson(req)) as { novels?: unknown } | null;
  const input: unknown[] = Array.isArray(body?.novels) ? body.novels : [];
  const novels = input.map(sanitizeNovel);
  if (input.length === 0 || input.length > MAX_NOVELS_PER_REQUEST || novels.includes(null)) {
    return NextResponse.json({ error: "Invalid novels" }, { status: 400 });
  }
  if (!(await putNovels(id, novels as ShelfNovel[]))) {
    return NextResponse.json({ error: "Too many novels" }, { status: 413 });
  }
  return NextResponse.json({ saved: true });
}
