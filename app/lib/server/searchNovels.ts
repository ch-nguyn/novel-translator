import * as cheerio from "cheerio";
import { bookPageUrl, NOVEL_SITES, NovelSite } from "../sites";
import { FoundNovel, hasChinese, isGuessedNovel, looseName, matchesTitle, mergeResults, parseCandidates, parseStatus, SearchCandidate, SearchResponse } from "../search";
import { complete } from "./llm";
import { fetchWithCheerio } from "./fetchContent";

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

export async function searchNovels(candidates: SearchCandidate[]): Promise<SearchResponse> {
  const searchable = NOVEL_SITES.filter((site) => SITE_SEARCH[site.domain]);
  const perSite = await Promise.all(searchable.map((site) => searchSite(site, candidates[0])));
  return {
    candidates,
    results: mergeResults(perSite.map((list) => list ?? []), candidates),
    failedSites: searchable.filter((_, i) => !perSite[i]).map((site) => site.domain),
  };
}

const GUESS_PROMPT = `You help find Chinese web novels on Chinese novel sites. The user typed the name of a novel (or of its author) the way Vietnamese readers know it: in Sino-Vietnamese (Hán Việt, e.g. "Già Thiên", "Phàm Nhân Tu Tiên"), translated into Vietnamese, without accents, or in pinyin.
Give the novel's original Chinese title, in simplified and traditional characters, and its author when you know it. When the user typed a Chinese title, the first candidate is that title itself (in simplified and traditional characters, with its author when you know it). When the name is a famous novel's, put that novel first. When you do not know a novel by that name, write the Sino-Vietnamese words with the Chinese characters they most likely stand for, and leave the author empty; do not invent authors.
Give up to 3 candidates, the most likely first. Answer with only this JSON:
{"candidates":[{"title":"简体书名","titleTraditional":"繁體書名","author":"作者 or empty","authorTraditional":"作者 or empty"}]}`;

// The Chinese names the typed one may stand for, most likely first. A typed
// Chinese name is searched as it is (the AI adds its other script and author).
export async function guessCandidates(apiKey: string, model: string, query: string): Promise<SearchCandidate[]> {
  const answer = await complete({ apiKey, model, system: GUESS_PROMPT, input: query, maxTokens: 400, task: "search" });
  const candidates = parseCandidates(answer);
  if (!hasChinese(query)) return candidates;
  const typed = looseName(query);
  const same = candidates.find((c) => looseName(c.title) === typed || (c.titleTraditional && looseName(c.titleTraditional) === typed));
  return [same ?? { title: query }, ...candidates.filter((c) => c !== same)].slice(0, 3);
}
