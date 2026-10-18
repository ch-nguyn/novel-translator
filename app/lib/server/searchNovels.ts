import * as cheerio from "cheerio";
import { bookPageUrl, NOVEL_SITES, NovelSite } from "../sites";
import {
  FoundNovel,
  hasChinese,
  isGuessedNovel,
  looseName,
  matchesTitle,
  parseCandidates,
  parseNames,
  parseStatus,
  queryKey,
  rankResults,
  SEARCH_AI_MODEL,
  SearchCandidate,
  SearchResponse,
  SiteResults,
} from "../search";
import { complete } from "./llm";
import { fetchWithCheerio } from "./fetchContent";
import { getRedis } from "./jobs";

// Searching the supported sites by a novel's name (see app/api/search)

// A search waits on the AI and the sites in a row; give up on a slow site sooner than on a chapter
const SEARCH_TIMEOUT_MS = 10_000;

interface SiteSearch {
  url: (homepage: string, query: string) => string;
  // The novels listed on a results page, with their links as written
  parse: ($: cheerio.CheerioAPI) => FoundNovel[];
}

// Keyed by NovelSite.domain (see ../sites)
const SITE_SEARCH: Record<string, SiteSearch> = {
  // Results: <dl> per novel with "<h3><a>[玄幻]凡人修仙传</a></h3>", "作者：忘语", "状态：连载".
  // Searches titles and authors (and pinyin); simplified characters only.
  "biquuge.com": {
    url: (homepage, query) => `${homepage}/search.php?q=${encodeURIComponent(query)}`,
    parse: ($) =>
      $("dl")
        .map((_, el) => {
          const link = $(el).find("h3 a").first();
          const info = $(el).find("dd.book_other").map((_, dd) => $(dd).text().trim()).get();
          const field = (label: string) => info.find((line) => line.startsWith(label))?.slice(label.length).trim() ?? "";
          return {
            url: link.attr("href") ?? "",
            site: "biquuge.com",
            // Without the category in front: "[玄幻]凡人修仙传"
            title: link.text().trim().replace(/^\[[^\]]*\]\s*/, ""),
            author: field("作者："),
            status: parseStatus(field("状态：")),
          };
        })
        .get(),
  },
  // Results: <li class="burl"> per novel. Searches titles and authors, in either script.
  "ixdzs.tw": {
    url: (homepage, query) => `${homepage}/bsearch?q=${encodeURIComponent(query)}`,
    parse: ($) =>
      $("li.burl")
        .map((_, el) => {
          const link = $(el).find("h3.bname a").first();
          return {
            url: link.attr("href") ?? "",
            site: "ixdzs.tw",
            title: (link.attr("title") || link.text()).trim(),
            author: $(el).find(".bauthor").first().text().trim(),
            // "連載中" or "已完結"
            status: parseStatus($(el).find(".lz, .end").first().text()),
          };
        })
        .get(),
  },
};

// The novels a site lists for `query`; null if the site could not be searched
async function searchPage(site: NovelSite, query: string): Promise<FoundNovel[] | null> {
  const search = SITE_SEARCH[site.domain];
  if (!search) return null;
  let page;
  try {
    page = await fetchWithCheerio(search.url(site.homepage, query), SEARCH_TIMEOUT_MS);
  } catch (e) {
    console.error(`[search] ${site.domain}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (!page) return null;
  const found: FoundNovel[] = [];
  for (const novel of search.parse(cheerio.load(page.html))) {
    let url: string | null = null;
    try {
      const absolute = new URL(novel.url, page.url);
      // Keep https when the site redirected to plain http
      absolute.protocol = "https:";
      url = bookPageUrl(absolute.href);
    } catch {
      // not a link to a novel
    }
    if (url && novel.title) found.push({ ...novel, url });
  }
  return found;
}

// A site's novels for the guessed name. The sites list the newest matches
// first, so a famous novel can be buried under fan works named after it; when
// it is not among them, its author's novels are searched too.
// One request at a time: biquuge.com refuses quick bursts.
async function searchSite(site: NovelSite, candidate: SearchCandidate): Promise<FoundNovel[] | null> {
  const byTitle = await searchPage(site, candidate.title);
  if (!byTitle) return null;
  if (!candidate.author || byTitle.some((novel) => isGuessedNovel(novel, candidate))) return byTitle;
  const byAuthor = (await searchPage(site, candidate.author)) ?? [];
  return [...byAuthor.filter((novel) => matchesTitle(novel, [candidate])), ...byTitle];
}

// The cache of what the AI said, shared by every reader: the Chinese names a
// typed one stands for, and found novels' names in Sino-Vietnamese. Popular
// novels are then found and named without asking the AI again. Every entry
// expires, so names nobody searches for any more do not pile up.
const GUESS_KEY = (query: string) => `search:guess:${queryKey(query)}`;
const NAME_KEY = (text: string) => `search:name:${text}`;
const GUESS_TTL_SECONDS = 30 * 24 * 3600;
const NAME_TTL_SECONDS = 90 * 24 * 3600;
// Longer "names" are blurbs or junk, not worth keeping
const MAX_CACHED_NAME_CHARS = 60;

async function cachedGuess(query: string): Promise<SearchCandidate[] | null> {
  try {
    const cached = await getRedis()?.get<SearchCandidate[]>(GUESS_KEY(query));
    return Array.isArray(cached) && cached.length > 0 ? cached : null;
  } catch {
    return null;
  }
}

// Only a guess that found novels is kept (see app/api/search)
export async function cacheGuess(query: string, candidates: SearchCandidate[]) {
  try {
    await getRedis()?.set(GUESS_KEY(query), candidates, { ex: GUESS_TTL_SECONDS });
  } catch {
    // only a cache
  }
}

const NAMES_PROMPT = `Transcribe each Chinese web novel title or author name into Sino-Vietnamese (Hán Việt), the way Vietnamese readers write them, with every word capitalized: 遮天 → Già Thiên, 凡人修仙传 → Phàm Nhân Tu Tiên, 辰东 → Thần Đông, 爱潜水的乌贼 → Ái Tiềm Thủy Đích Ô Tặc. Write "：" as ": " and "，" as ", "; keep Latin letters and digits. No Chinese characters in the answer.
The input is a JSON object of numbered names. Answer with only a JSON object with the same numbers: {"1":"Già Thiên","2":"Thần Đông"}.`;

// Names asked of the AI at once: a long list comes back with some missing or merged
const NAMES_PER_CALL = 8;

// The AI's Sino-Vietnamese names for `texts`, in order ("" where it gave none)
async function askNames(texts: string[], apiKey: string): Promise<string[]> {
  const answer = await complete({
    apiKey,
    model: SEARCH_AI_MODEL,
    system: NAMES_PROMPT,
    input: JSON.stringify(Object.fromEntries(texts.map((text, i) => [i + 1, text]))),
    maxTokens: 200 + 40 * texts.length,
    task: "search-names",
    reasoningEffort: "none",
  });
  const names = parseNames(answer, texts.length);
  if (!names || names.some((name) => !name)) console.error(`[search-names] incomplete answer for ${texts.length} names: ${answer.slice(0, 300)}`);
  return names ?? texts.map(() => "");
}

// Sino-Vietnamese names for `texts`, by text: from the cache, else from the
// AI (when there is a key). Missing when neither has them.
async function vietnameseNames(texts: string[], apiKey: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (texts.length === 0) return names;
  const redis = getRedis();
  try {
    const cached = redis ? await redis.mget<unknown[]>(...texts.map(NAME_KEY)) : [];
    // Values come back JSON-parsed: a name like "1984" is a number
    texts.forEach((text, i) => {
      const name = cached[i];
      if (name !== null && name !== undefined && name !== "") names.set(text, String(name));
    });
  } catch {
    // only a cache
  }
  const missing = texts.filter((text) => !names.has(text));
  if (missing.length === 0 || !apiKey) return names;
  const pipeline = redis?.pipeline();
  // In small batches side by side, then once more for any the AI skipped
  for (let attempt = 0; attempt < 2; attempt++) {
    const asking = texts.filter((text) => !names.has(text));
    if (asking.length === 0) break;
    const batches = Array.from({ length: Math.ceil(asking.length / NAMES_PER_CALL) }, (_, i) => asking.slice(i * NAMES_PER_CALL, (i + 1) * NAMES_PER_CALL));
    const answers = await Promise.all(
      batches.map((batch) =>
        askNames(batch, apiKey).catch((e) => {
          console.error(`[search-names] ${e instanceof Error ? e.message : e}`);
          // The novels are still listed, under their Chinese names
          return batch.map(() => "");
        })
      )
    );
    batches.forEach((batch, b) =>
      batch.forEach((text, i) => {
        const name = answers[b][i];
        if (!name) return;
        names.set(text, name);
        if (text.length <= MAX_CACHED_NAME_CHARS) pipeline?.set(NAME_KEY(text), name, { ex: NAME_TTL_SECONDS });
      })
    );
  }
  if (pipeline && pipeline.length() > 0) await pipeline.exec().catch(() => {});
  return names;
}

// One site's novels with their Sino-Vietnamese names. Each site is named as
// soon as it answers, while the other is still being searched.
async function searchAndName(site: NovelSite, candidates: SearchCandidate[], apiKey: string): Promise<SiteResults> {
  const found = await searchSite(site, candidates[0]);
  if (!found) return { site: site.domain, results: [], failed: true };
  const results = rankResults(found, candidates);
  const names = await vietnameseNames([...new Set(results.flatMap((novel) => [novel.title, novel.author]).filter(Boolean))], apiKey);
  return {
    site: site.domain,
    results: results.map((novel) => ({ ...novel, titleVi: names.get(novel.title), authorVi: names.get(novel.author) })),
    failed: false,
  };
}

export async function searchNovels(candidates: SearchCandidate[], apiKey: string): Promise<SearchResponse> {
  const searchable = NOVEL_SITES.filter((site) => SITE_SEARCH[site.domain]);
  return { candidates, sites: await Promise.all(searchable.map((site) => searchAndName(site, candidates, apiKey))) };
}

const GUESS_PROMPT = `You help find Chinese web novels on Chinese novel sites. The user typed the name of a novel (or of its author) the way Vietnamese readers know it: in Sino-Vietnamese (Hán Việt, e.g. "Già Thiên", "Phàm Nhân Tu Tiên"), translated into Vietnamese, without accents, or in pinyin.
Give the novel's original Chinese title, in simplified and traditional characters, and its author when you know it. When the user typed a Chinese title, the first candidate is that title itself (in simplified and traditional characters, with its author when you know it). When the name is a famous novel's, put that novel first. When you do not know a novel by that name, write the Sino-Vietnamese words with the Chinese characters they most likely stand for, and leave the author empty; do not invent authors.
Give up to 3 candidates, the most likely first. Answer with only this JSON:
{"candidates":[{"title":"简体书名","titleTraditional":"繁體書名","author":"作者 or empty","authorTraditional":"作者 or empty"}]}`;

// The Chinese names the typed one may stand for, most likely first: as
// guessed before for the same words (`fresh` false), else by the AI (null
// without a key; empty when its answer was unusable). A typed Chinese name is
// searched as it is (the AI adds its other script and author).
export async function guessCandidates(apiKey: string, query: string): Promise<{ candidates: SearchCandidate[]; fresh: boolean } | null> {
  const cached = await cachedGuess(query);
  if (cached) return { candidates: cached, fresh: false };
  if (!apiKey) return null;
  const answer = await complete({
    apiKey,
    model: SEARCH_AI_MODEL,
    system: GUESS_PROMPT,
    input: query,
    maxTokens: 400,
    task: "search",
    reasoningEffort: "none",
  });
  let candidates = parseCandidates(answer);
  if (candidates.length === 0) return { candidates, fresh: true };
  if (hasChinese(query)) {
    const typed = looseName(query);
    const same = candidates.find((c) => looseName(c.title) === typed || (c.titleTraditional && looseName(c.titleTraditional) === typed));
    candidates = [same ?? { title: query }, ...candidates.filter((c) => c !== same)].slice(0, 3);
  }
  return { candidates, fresh: true };
}
