// Finding a novel by its name on the supported sites. Pure functions (no
// server or browser APIs), shared by the search route, the page and the tests.

// The Chinese name the sites are searched with, as the AI guessed it from the
// typed name (or the typed name itself when it is Chinese already). The sites
// differ in script: biquuge.com wants simplified, ixdzs.tw shows traditional.
export interface SearchCandidate {
  title: string;
  titleTraditional?: string;
  author?: string;
  authorTraditional?: string;
}

// A novel found on one of the sites
export interface FoundNovel {
  // Its page on the site, which opens at the first chapter
  url: string;
  // NovelSite.domain
  site: string;
  title: string;
  author: string;
  status: "ongoing" | "completed" | null;
}

export interface SearchResponse {
  candidates: SearchCandidate[];
  results: FoundNovel[];
  // Sites that could not be searched (down, blocking, changed)
  failedSites: string[];
}

// Why a search could not start: the typed name needs the AI to become Chinese
export type SearchErrorCode = "needKey" | "badKey" | "aiFailed" | "invalid";

export const MAX_QUERY_CHARS = 100;
export const MAX_RESULTS = 24;

const HAN = /\p{Script=Han}/u;

export function hasChinese(text: string): boolean {
  return HAN.test(text);
}

// A name compared loosely: no spaces, punctuation or brackets ("【遮天】", "遮天：")
export function looseName(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

// Text compared without Vietnamese accents ("Gia thien" finds "Già Thiên")
export function foldAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

function names(candidates: SearchCandidate[], key: "title" | "author"): string[] {
  const traditional = key === "title" ? "titleTraditional" : "authorTraditional";
  return candidates
    .flatMap((c) => [c[key], c[traditional]])
    .filter((name): name is string => !!name)
    .map(looseName)
    .filter(Boolean);
}

// Whether a found novel has exactly a guessed name, in either script
export function isExactTitle(novel: FoundNovel, candidates: SearchCandidate[]): boolean {
  return names(candidates, "title").includes(looseName(novel.title));
}

// Whether a found novel is the guessed one: its exact title, by its author
// when the author is known (look-alikes by others share famous titles)
export function isGuessedNovel(novel: FoundNovel, candidate: SearchCandidate): boolean {
  if (!isExactTitle(novel, [candidate])) return false;
  const authors = names([candidate], "author");
  return authors.length === 0 || authors.includes(looseName(novel.author));
}

// Whether a novel found by its author's name is the one searched for (and not
// another of their books): its title starts with a guessed one
export function matchesTitle(novel: FoundNovel, candidates: SearchCandidate[]): boolean {
  const title = looseName(novel.title);
  return names(candidates, "title").some((name) => title.startsWith(name));
}

// How well a found novel fits the guessed names: the exact title by the
// guessed author first, then the exact title, then titles starting with it
// (sequels, "…之…" fan works), then the rest in the sites' order
export function relevance(novel: FoundNovel, candidates: SearchCandidate[]): number {
  const title = looseName(novel.title);
  const titles = names(candidates, "title");
  let score = titles.includes(title) ? 4 : titles.some((name) => title.startsWith(name)) ? 2 : titles.some((name) => title.includes(name)) ? 1 : 0;
  const authors = names(candidates, "author");
  if (score > 0 && authors.includes(looseName(novel.author))) score += 4;
  return score;
}

// The sites' results together: taken in turn from each site (so neither
// drowns the other), the same page once, most relevant first
export function mergeResults(perSite: FoundNovel[][], candidates: SearchCandidate[]): FoundNovel[] {
  const seen = new Set<string>();
  const merged: FoundNovel[] = [];
  const longest = Math.max(0, ...perSite.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of perSite) {
      const novel = list[i];
      if (!novel || seen.has(novel.url)) continue;
      seen.add(novel.url);
      merged.push(novel);
    }
  }
  // Array.prototype.sort is stable: equally relevant novels keep the merged order
  return merged
    .map((novel) => ({ novel, score: relevance(novel, candidates) }))
    .sort((a, b) => b.score - a.score)
    .map(({ novel }) => novel)
    .slice(0, MAX_RESULTS);
}

// The AI's answer as candidates: the JSON object in it (models sometimes wrap
// it in a code fence or a sentence), with only usable Chinese names kept
export function parseCandidates(answer: string): SearchCandidate[] {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (data as { candidates?: unknown })?.candidates;
  if (!Array.isArray(list)) return [];
  const name = (value: unknown) => (typeof value === "string" && hasChinese(value) && value.length <= 50 ? value.trim() : undefined);
  const candidates: SearchCandidate[] = [];
  for (const item of list) {
    const title = name(item?.title);
    if (!title || candidates.some((c) => c.title === title)) continue;
    candidates.push({
      title,
      titleTraditional: name(item.titleTraditional),
      author: name(item.author),
      authorTraditional: name(item.authorTraditional),
    });
    if (candidates.length === 3) break;
  }
  return candidates;
}

// A novel's status from the site's wording (连载/連載中, 完本/完结/已完結)
export function parseStatus(text: string): FoundNovel["status"] {
  if (/完本|完结|完結|全本/.test(text)) return "completed";
  if (/连载|連載/.test(text)) return "ongoing";
  return null;
}
