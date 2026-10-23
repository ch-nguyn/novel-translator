import { pool } from "./db";
import { extractNovelSlug } from "../storage";
import { findSite } from "../sites";
import { sanitizeTerms } from "../glossary";
import { ChapterRecap, GlossaryTerm } from "../types";
import { sanitizeRecaps, unionRecaps } from "../recaps";
import { LIBRARY_USER_HEADER } from "../librarySync";
import { replacesPlace } from "../readingPlace";

// A signed-in user's bookshelf, kept so it follows them to another device (see
// db/library.sql and app/lib/librarySync.ts): per novel, the place further
// along wins (see replacesPlace).

// What a device sends about a novel (LibraryEntry without its own bookkeeping)
export interface ShelfNovel {
  slug: string;
  name: string;
  url: string;
  chapterTitle: string;
  paragraph: number;
  removed: boolean;
  updatedAt: number;
  // The device that sent it; "" from an app older than this
  device: string;
}

// Novels a user may keep, deleted ones included
const MAX_NOVELS = 1000;
// Novels sent at once (a device keeps at most 300)
export const MAX_NOVELS_PER_REQUEST = 300;
const MAX_CLOCK_AHEAD_MS = 24 * 60 * 60 * 1000;
// Largest request: a novel's names at their cap are about 1 MB
export const MAX_BODY_BYTES = 3 * 1024 * 1024;

// The request's JSON body; null if it is not JSON or larger than
// MAX_BODY_BYTES (reading stops there)
export async function readJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES || !req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(read.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

// A request still on its way after another account signed in is refused
export function sameUser(req: Request, userId: string): boolean {
  return req.headers.get(LIBRARY_USER_HEADER) === userId;
}

function text(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

export function validUpdatedAt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= Date.now() + MAX_CLOCK_AHEAD_MS;
}

export function validSlug(value: unknown): value is string {
  return typeof value === "string" && /^\S{1,120}$/.test(value);
}

// A novel from a request; null if anything is off (e.g. a link to a site the
// app does not read, or one of another novel)
export function sanitizeNovel(input: unknown): ShelfNovel | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const url = text(raw.url, 500);
  const name = text(raw.name, 200);
  const chapterTitle = text(raw.chapterTitle, 300);
  if (!validSlug(raw.slug) || !url || name === null || chapterTitle === null) return null;
  if (!/^https?:\/\//.test(url) || !findSite(url) || extractNovelSlug(url) !== raw.slug) return null;
  const paragraph = raw.paragraph;
  if (typeof paragraph !== "number" || !Number.isSafeInteger(paragraph) || paragraph < 0 || paragraph > 100_000) return null;
  if (typeof raw.removed !== "boolean" || !validUpdatedAt(raw.updatedAt)) return null;
  const device = raw.device ?? "";
  if (typeof device !== "string" || !/^[A-Za-z0-9-]{0,64}$/.test(device)) return null;
  return { slug: raw.slug, name, url, chapterTitle, paragraph, removed: raw.removed, updatedAt: raw.updatedAt, device };
}

export async function getLibrary(userId: string): Promise<{ novels: ShelfNovel[]; glossaries: { slug: string; updatedAt: number }[] }> {
  const [novels, glossaries] = await Promise.all([
    pool.query(
      `select "slug", "name", "url", "chapter_title", "paragraph", "removed", "updated_at", "device" from "library_novel" where "user_id" = $1`,
      [userId]
    ),
    pool.query(`select "slug", "updated_at" from "library_glossary" where "user_id" = $1`, [userId]),
  ]);
  return {
    novels: novels.rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      url: r.url,
      chapterTitle: r.chapter_title,
      paragraph: r.paragraph,
      removed: r.removed,
      updatedAt: Number(r.updated_at),
      device: r.device,
    })),
    glossaries: glossaries.rows.map((r) => ({ slug: r.slug, updatedAt: Number(r.updated_at) })),
  };
}

// Keeps each novel that wins over the stored one (replacesPlace). A deleted
// novel's names go too. False (nothing kept) if the shelf would grow past MAX_NOVELS.
export async function putNovels(userId: string, novels: ShelfNovel[]): Promise<boolean> {
  // The latest of a novel sent twice
  const latest = new Map<string, ShelfNovel>();
  for (const novel of novels) {
    if ((latest.get(novel.slug)?.updatedAt ?? 0) < novel.updatedAt) latest.set(novel.slug, novel);
  }
  const sent = [...latest.values()];
  if (sent.length === 0) return true;
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Serializes a user's writes, so two devices cannot both pass the size check
    await client.query(`select pg_advisory_xact_lock(hashtext('library:' || $1))`, [userId]);
    const { rows: counts } = await client.query(
      `select count(*)::int as "total", count(*) filter (where "slug" = any($2))::int as "known" from "library_novel" where "user_id" = $1`,
      [userId, sent.map((n) => n.slug)]
    );
    if (counts[0].total + sent.length - counts[0].known > MAX_NOVELS) {
      await client.query("rollback");
      return false;
    }
    // Compared under the lock: no other write of the user's comes in between
    const { rows: storedRows } = await client.query(
      `select "slug", "url", "chapter_title", "paragraph", "removed", "updated_at", "device" from "library_novel" where "user_id" = $1 and "slug" = any($2)`,
      [userId, sent.map((n) => n.slug)]
    );
    const stored = new Map(
      storedRows.map((r) => [
        r.slug as string,
        { url: r.url, chapterTitle: r.chapter_title, paragraph: r.paragraph, removed: r.removed, updatedAt: Number(r.updated_at), device: r.device as string },
      ])
    );
    const rows = sent
      .filter((n) => {
        const kept = stored.get(n.slug);
        return !kept || replacesPlace(kept, n, kept.device === n.device);
      })
      .map((n) => ({
        slug: n.slug,
        name: n.name,
        url: n.url,
        chapter_title: n.chapterTitle,
        paragraph: n.paragraph,
        removed: n.removed,
        // Never earlier than the change it replaces: a place further along
        // read before it does not let an older deletion through
        updated_at: Math.max(n.updatedAt, stored.get(n.slug)?.updatedAt ?? 0),
        device: n.device,
      }));
    await client.query(
      `insert into "library_novel" ("user_id", "slug", "name", "url", "chapter_title", "paragraph", "removed", "updated_at", "device")
       select $1, x."slug", x."name", x."url", x."chapter_title", x."paragraph", x."removed", x."updated_at", x."device"
       from jsonb_to_recordset($2::jsonb) as x("slug" text, "name" text, "url" text, "chapter_title" text, "paragraph" integer, "removed" boolean, "updated_at" bigint, "device" text)
       on conflict ("user_id", "slug") do update set
         "name" = excluded."name", "url" = excluded."url", "chapter_title" = excluded."chapter_title",
         "paragraph" = excluded."paragraph", "removed" = excluded."removed", "updated_at" = excluded."updated_at",
         "device" = excluded."device"`,
      [userId, JSON.stringify(rows)]
    );
    await client.query(
      `delete from "library_glossary" g using "library_novel" n
       where g."user_id" = $1 and n."user_id" = $1 and n."slug" = g."slug" and n."removed" and g."updated_at" < n."updated_at"`,
      [userId]
    );
    await client.query("commit");
    return true;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// null when the account has no names for the novel
export async function getGlossary(
  userId: string,
  slug: string
): Promise<{ terms: GlossaryTerm[]; recaps: ChapterRecap[]; updatedAt: number } | null> {
  const { rows } = await pool.query(`select "terms", "recaps", "updated_at" from "library_glossary" where "user_id" = $1 and "slug" = $2`, [userId, slug]);
  if (rows.length === 0) return null;
  return { terms: sanitizeTerms(rows[0].terms) ?? [], recaps: sanitizeRecaps(rows[0].recaps) ?? [], updatedAt: Number(rows[0].updated_at) };
}

// Keeps a novel's names if the stored ones are still those of `baseUpdatedAt`
// (what the device last had; 0 for none), so names added on another device
// meanwhile are not overwritten. Only for a novel on the shelf. Recaps only
// add up: those sent join the stored ones (a device may lack some it could
// not store); none are sent by an app older than them.
// "conflict": the stored names changed meanwhile; "absent": no such novel.
export async function putGlossary(
  userId: string,
  slug: string,
  terms: GlossaryTerm[],
  recaps: ChapterRecap[] | null,
  updatedAt: number,
  baseUpdatedAt: number
): Promise<"saved" | "conflict" | "absent"> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // The stored recaps, locked until they are written back with those sent
    const { rows: stored } = await client.query(
      `select "recaps" from "library_glossary" where "user_id" = $1 and "slug" = $2 for update`,
      [userId, slug]
    );
    const kept = sanitizeRecaps(stored[0]?.recaps) ?? [];
    const combined = recaps ? unionRecaps(kept, recaps) : kept;
    const { rowCount } = await client.query(
      `insert into "library_glossary" ("user_id", "slug", "terms", "updated_at", "recaps")
       select $1, $2, $3, $4, $6
       where exists (select 1 from "library_novel" where "user_id" = $1 and "slug" = $2 and not "removed")
       on conflict ("user_id", "slug") do update set "terms" = excluded."terms", "updated_at" = excluded."updated_at", "recaps" = excluded."recaps"
       where "library_glossary"."updated_at" = $5 and "library_glossary"."updated_at" < excluded."updated_at"`,
      [userId, slug, JSON.stringify(terms), updatedAt, baseUpdatedAt, JSON.stringify(combined)]
    );
    const { rows } =
      (rowCount ?? 0) > 0
        ? { rows: [] }
        : await client.query(`select 1 from "library_novel" where "user_id" = $1 and "slug" = $2 and not "removed"`, [userId, slug]);
    await client.query("commit");
    if ((rowCount ?? 0) > 0) return "saved";
    return rows.length > 0 ? "conflict" : "absent";
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
