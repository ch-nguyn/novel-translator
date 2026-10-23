import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../lib/server/auth";
import { getGlossary, putGlossary, readJson, sameUser, validSlug, validUpdatedAt } from "../../../lib/server/library";
import { sanitizeTerms } from "../../../lib/glossary";
import { sanitizeRecaps } from "../../../lib/recaps";

// The names of one novel on the signed-in user's bookshelf, and its chapter
// summaries: GET ?slug= returns {terms, recaps, updatedAt} ({terms: null,
// updatedAt: 0} when there are none), PUT {slug, terms, recaps, updatedAt,
// baseUpdatedAt} saves them if the stored ones are
// still those of baseUpdatedAt: {saved, conflict} (conflict: fetch, combine
// and send again).

async function userId(req: NextRequest): Promise<string | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user.id ?? null;
}

export async function GET(req: NextRequest) {
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!sameUser(req, id)) return NextResponse.json({ error: "Signed in as someone else" }, { status: 409 });
  const slug = req.nextUrl.searchParams.get("slug");
  if (!validSlug(slug)) return NextResponse.json({ error: "Invalid novel" }, { status: 400 });
  const stored = await getGlossary(id, slug);
  return NextResponse.json(stored ?? { terms: null, updatedAt: 0 }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!sameUser(req, id)) return NextResponse.json({ error: "Signed in as someone else" }, { status: 409 });
  const body = (await readJson(req)) as Record<string, unknown> | null;
  const terms = sanitizeTerms(body?.terms);
  // Absent from an app older than them
  const recaps = body?.recaps === undefined ? null : sanitizeRecaps(body.recaps);
  const base = body?.baseUpdatedAt;
  if (
    !body ||
    !validSlug(body.slug) ||
    !Array.isArray(body.terms) ||
    !terms ||
    (body.recaps !== undefined && !recaps) ||
    !validUpdatedAt(body.updatedAt) ||
    !(base === 0 || validUpdatedAt(base))
  ) {
    return NextResponse.json({ error: "Invalid names" }, { status: 400 });
  }
  const result = await putGlossary(id, body.slug, terms, recaps, body.updatedAt, base as number);
  return NextResponse.json({ saved: result === "saved", conflict: result === "conflict" });
}
