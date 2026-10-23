import { GlossaryTerm, TERM_KINDS, TermKind, TermNote } from "./types";
import { compareOrder, sortByChapter } from "./sites";

// A novel's glossary: the names its translations use, so every chapter writes
// them the same way. Built automatically (each translated chapter reports the
// names it introduced), corrected by the user. Shared by the server and the
// browser, so it must not import server-only code.

// Per novel: names found automatically stop being added at MAX_TERMS, leaving
// room for the user's own up to MAX_STORED_TERMS (about 70 characters each in
// browser storage; only the names a chapter contains go to the model)
export const MAX_TERMS = 8000;
export const MAX_STORED_TERMS = 10000;
const MAX_SOURCE_LENGTH = 30;
const MAX_TARGET_LENGTH = 60;
const MAX_ALIASES = 10;
// Names given to the model with one chapter
const MAX_PROMPT_TERMS = 300;
// Notes kept per name: the first (who it is) and the latest
const MAX_NOTES = 6;
export const MAX_NOTE_LENGTH = 160;
const MAX_NOTE_CHAPTER_LENGTH = 100;

// Collapses whitespace (names go into prompts and regexes one per line)
function cleanName(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/[\s\u0000-\u001f]+/g, " ").trim();
  return name.length <= maxLength ? name : null;
}

// Validates a glossary from an untrusted source (a request, an imported file).
// Malformed entries are dropped; null if it is not a list or is too long.
export function sanitizeTerms(value: unknown, max = MAX_STORED_TERMS): GlossaryTerm[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const terms: GlossaryTerm[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const source = cleanName(raw.source ?? "", MAX_SOURCE_LENGTH);
    const target = cleanName(raw.target, MAX_TARGET_LENGTH);
    if (source === null || !target) continue;
    const kind: TermKind = TERM_KINDS.includes(raw.kind as TermKind) ? (raw.kind as TermKind) : "other";
    const term: GlossaryTerm = { source, target, kind };
    if (kind === "character" && (raw.gender === "male" || raw.gender === "female")) term.gender = raw.gender;
    if (Array.isArray(raw.aliases)) {
      const aliases = raw.aliases
        .map((a) => cleanName(a, MAX_TARGET_LENGTH))
        .filter((a): a is string => !!a && a !== target);
      if (aliases.length > 0) term.aliases = [...new Set(aliases)].slice(0, MAX_ALIASES);
    }
    if (raw.edited === true) term.edited = true;
    const notes = sanitizeNotes(raw.notes);
    if (notes.length > 0) term.notes = notes;
    terms.push(term);
  }
  return terms;
}

// A place in a novel (see chapterOrder): a few whole numbers, else undefined
export function sanitizeOrder(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) return undefined;
  return value.every((n) => Number.isSafeInteger(n) && n >= 0) ? (value as number[]) : undefined;
}

function sanitizeNotes(value: unknown): TermNote[] {
  if (!Array.isArray(value)) return [];
  const notes: TermNote[] = [];
  for (const item of value.slice(-MAX_NOTES)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const text = cleanName(raw.text, MAX_NOTE_LENGTH);
    if (!text) continue;
    const note: TermNote = { text };
    const chapter = cleanName(raw.chapter, MAX_NOTE_CHAPTER_LENGTH);
    if (chapter) note.chapter = chapter;
    const order = sanitizeOrder(raw.order);
    if (order) note.order = order;
    if (Number.isSafeInteger(raw.at) && (raw.at as number) > 0) note.at = raw.at as number;
    notes.push(note);
  }
  return notes;
}

// Adds what chapters told of a name to what was known, in the order of the
// chapters (they may come in any order, e.g. a scan goes backwards); the same
// note again is not repeated. Unchanged (the same array) if nothing was new.
function addNotes(known: TermNote[] | undefined, incoming: TermNote[] | undefined): TermNote[] | undefined {
  const fresh = (incoming ?? []).filter((note, i, all) => !known?.some((k) => k.text === note.text) && all.findIndex((n) => n.text === note.text) === i);
  if (fresh.length === 0) return known;
  const notes = sortByChapter([...(known ?? []), ...fresh]);
  // The first says who it is
  return notes.length > MAX_NOTES ? [notes[0], ...notes.slice(-(MAX_NOTES - 1))] : notes;
}

// Records which chapter told the notes found in it, and when it was saved
export function stampNotes(terms: GlossaryTerm[], chapter: string, order: number[] | null, at: number): GlossaryTerm[] {
  const stamp = (note: TermNote): TermNote => {
    if (note.chapter) return note;
    const stamped: TermNote = { ...note, chapter: chapter.slice(0, MAX_NOTE_CHAPTER_LENGTH), at };
    if (order) stamped.order = order;
    return stamped;
  };
  return terms.map((t) => (t.notes ? { ...t, notes: t.notes.map(stamp) } : t));
}

// The notes of a name a reader may see in the chapter at `order`: none from
// further on (e.g. chapters translated ahead), nor from chapters whose place is
// not known (one read earlier cannot be told from one ahead)
export function visibleNotes(term: GlossaryTerm, order: number[] | null): TermNote[] {
  return (term.notes ?? []).filter((n) => !!n.order && !!order && compareOrder(n.order, order) <= 0);
}

// Identifies a term in a glossary: its original text, or for a name the user
// corrected without one, its translation
export function termKey(term: GlossaryTerm): string {
  return term.source ? `s:${term.source}` : `t:${term.target}`;
}

// What the model needs to translate a chapter (no history or bookkeeping)
export function promptTerms(terms: GlossaryTerm[]): GlossaryTerm[] {
  return terms
    .filter((t) => t.source)
    .map(({ source, target, kind, gender }) => (gender ? { source, target, kind, gender } : { source, target, kind }));
}

// What the model looking for a chapter's names needs: also the latest note of
// each name, so it does not note the same again
export function memoryTerms(terms: GlossaryTerm[]): GlossaryTerm[] {
  const latest = new Map(terms.filter((t) => t.source && t.notes?.length).map((t) => [t.source, t.notes!.at(-1)!.text]));
  return promptTerms(terms).map((t) => (latest.has(t.source) ? { ...t, notes: [{ text: latest.get(t.source)! }] } : t));
}

const KIND_LABELS: Record<TermKind, string> = {
  character: "nhân vật",
  place: "địa danh",
  organization: "thế lực",
  skill: "công pháp/cảnh giới",
  item: "vật phẩm",
  other: "khác",
};

// The part of the system prompt listing the glossary names that appear in
// `text` (only those, so a long glossary does not bloat every request).
// Empty when none do.
export function glossaryPrompt(terms: GlossaryTerm[], text: string): string {
  const relevant = terms
    .filter((t) => t.source && text.includes(t.source))
    // Longer names first: they are the specific ones when one contains another
    .sort((a, b) => b.source.length - a.source.length)
    .slice(0, MAX_PROMPT_TERMS);
  if (relevant.length === 0) return "";
  const lines = relevant.map((t) => {
    const gender = t.gender === "male" ? ", nam" : t.gender === "female" ? ", nữ" : "";
    return `${t.source} = ${t.target} (${KIND_LABELS[t.kind]}${gender})`;
  });
  return (
    "\n\nBẢNG TÊN RIÊNG CỦA TRUYỆN (các chương trước đã dịch như sau - BẮT BUỘC dùng đúng cách viết này, không tự đổi; giới tính để chọn đúng đại từ hắn/nàng):\n" +
    lines.join("\n")
  );
}

// Looks like a proper name: every word capitalized ("Lâm Động", not "rừng xanh")
function isNameLike(text: string): boolean {
  return text.split(" ").every((word) => /^[\p{Lu}\p{N}]/u.test(word));
}

function addAlias(term: GlossaryTerm, alias: string): GlossaryTerm {
  if (alias === term.target || term.aliases?.includes(alias)) return term;
  return { ...term, aliases: [...(term.aliases ?? []), alias].slice(-MAX_ALIASES) };
}

// Adds the names a chapter introduced. A name the glossary already has keeps
// its translation; a different translation of it is remembered as an alias,
// which `applyNames` then replaces, so chapters translated at the same time
// still end up consistent. Returns the glossary unchanged if nothing is new.
export function mergeTerms(existing: GlossaryTerm[], incoming: GlossaryTerm[]): GlossaryTerm[] {
  if (incoming.length === 0) return existing;
  const terms = [...existing];
  const index = new Map(terms.map((t, i) => [termKey(t), i]));
  // Ways of writing a name that were replaced (e.g. corrected by the user) → the current one
  const corrected = new Map<string, string>();
  for (const t of terms) for (const alias of t.aliases ?? []) corrected.set(alias, t.target);
  let changed = false;
  for (const found of incoming) {
    const target = corrected.get(found.target);
    const term = target ? { ...found, target } : found;
    const at = index.get(termKey(term));
    if (at === undefined) {
      if (terms.length >= MAX_TERMS) continue;
      index.set(termKey(term), terms.length);
      const notes = addNotes(undefined, term.notes);
      terms.push(notes ? { ...term, notes } : term);
      changed = true;
      continue;
    }
    let current = terms[at];
    if (term.target !== current.target && isNameLike(term.target)) current = addAlias(current, term.target);
    if (!current.gender && term.gender && current.kind === "character") current = { ...current, gender: term.gender };
    const notes = addNotes(current.notes, term.notes);
    if (notes !== current.notes) current = { ...current, notes };
    if (current !== terms[at]) {
      terms[at] = current;
      changed = true;
    }
  }
  return changed ? terms : existing;
}

// Merges a glossary file the user imported: its translations win over the
// ones already there
export function importTerms(existing: GlossaryTerm[], imported: GlossaryTerm[]): GlossaryTerm[] {
  const terms = [...existing];
  const index = new Map(terms.map((t, i) => [termKey(t), i]));
  for (const term of imported) {
    const at = index.get(termKey(term));
    if (at === undefined) {
      if (terms.length >= MAX_STORED_TERMS) continue;
      index.set(termKey(term), terms.length);
      terms.push({ ...term, edited: true });
    } else {
      const current = terms[at];
      const aliases = [...(current.aliases ?? []), ...(term.aliases ?? [])];
      if (current.target !== term.target) aliases.push(current.target);
      terms[at] = {
        ...current,
        ...term,
        aliases: [...new Set(aliases)].filter((a) => a !== term.target).slice(-MAX_ALIASES),
        edited: true,
      };
    }
  }
  return terms;
}

// Two copies of a glossary both changed since they were last the same (on two
// devices): every name of `newer`, then the names only `older` has
export function unionTerms(newer: GlossaryTerm[], older: GlossaryTerm[]): GlossaryTerm[] {
  const keys = new Set(newer.map(termKey));
  // A name both have keeps `newer`'s translation, and what both were told of it
  const olderNotes = new Map(older.filter((t) => t.notes).map((t) => [termKey(t), t.notes]));
  const terms = newer.map((t) => {
    const notes = addNotes(t.notes, olderNotes.get(termKey(t)));
    return notes === t.notes ? t : { ...t, notes };
  });
  for (const term of older) {
    if (terms.length >= MAX_STORED_TERMS) break;
    if (!keys.has(termKey(term))) terms.push(term);
  }
  return terms;
}

// The user corrected a name in the text: every term written `from` is now
// written `to`, and `from` is remembered so saved and future chapters get
// fixed too. A name the glossary did not have is added (without its original
// text, so it is only fixed in chapters, not given to the model).
export function renameTerm(terms: GlossaryTerm[], from: string, to: string): GlossaryTerm[] {
  if (!from || !to || from === to) return terms;
  let renamed = false;
  let updated = terms.map((t) => {
    if (t.target !== from) return t;
    renamed = true;
    const aliases = [...(t.aliases ?? []).filter((a) => a !== to && a !== from), from].slice(-MAX_ALIASES);
    return { ...t, target: to, aliases, edited: true };
  });
  if (renamed) return updated;
  // Already a name the glossary has: `from` was just another way of writing it
  const existing = updated.findIndex((t) => t.target === to);
  if (existing >= 0) {
    updated = [...updated];
    updated[existing] = { ...addAlias(updated[existing], from), edited: true };
    return updated;
  }
  if (updated.length >= MAX_STORED_TERMS) throw new GlossaryFullError();
  return [...updated, { source: "", target: to, kind: "other", aliases: [from], edited: true }];
}

export class GlossaryFullError extends Error {
  constructor() {
    super(`This novel already has ${MAX_STORED_TERMS} names. Delete some in Library → Names first.`);
    this.name = "GlossaryFullError";
  }
}

// The user edited a term in the glossary list. `shownTarget` is the name the
// form started from: if it was left as is, the current name stays (another tab
// may have corrected it meanwhile).
export function editTerm(
  terms: GlossaryTerm[],
  key: string,
  shownTarget: string,
  edit: Pick<GlossaryTerm, "target" | "kind" | "gender">
): GlossaryTerm[] {
  return terms.map((t) => {
    if (termKey(t) !== key) return t;
    const change = edit.target === shownTarget ? { ...edit, target: t.target } : edit;
    const aliases =
      change.target !== t.target
        ? [...(t.aliases ?? []).filter((a) => a !== change.target), t.target].slice(-MAX_ALIASES)
        : t.aliases;
    const edited: GlossaryTerm = { ...t, target: change.target, kind: change.kind, aliases, edited: true };
    if (change.kind === "character" && change.gender) edited.gender = change.gender;
    else delete edited.gender;
    return edited;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Rewrites every alias in a text to its name's current translation. Whole
// words only, and a name that contains an alias ("Thanh Sơn Tông" when
// "Thanh Sơn" is an alias) is left alone. Build once to fix many texts.
export function makeNameFixer(terms: GlossaryTerm[]): (text: string) => string {
  const replacements = new Map<string, string>();
  const targets = new Set(terms.map((t) => t.target));
  for (const t of terms) {
    for (const alias of t.aliases ?? []) {
      // An alias that is also another name's translation is ambiguous: leave it
      if (alias && !targets.has(alias)) replacements.set(alias, t.target);
    }
  }
  if (replacements.size === 0) return (text) => text;
  // Names containing an alias as whole words, which must be matched first
  const shielded = [...targets].filter((target) => {
    const words = target.split(" ");
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j <= words.length; j++) {
        if (replacements.has(words.slice(i, j).join(" "))) return true;
      }
    }
    return false;
  });
  const words = [...replacements.keys(), ...shielded].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${words.join("|")})(?![\\p{L}\\p{M}\\p{N}])`, "gu");
  return (text) => text.replace(pattern, (match) => replacements.get(match) ?? match);
}

export function applyNames(text: string, terms: GlossaryTerm[]): string {
  return makeNameFixer(terms)(text);
}
