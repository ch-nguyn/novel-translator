"use client";

import { useEffect, useRef, useState } from "react";
import { Translations } from "../lib/i18n";
import { FoundNovel, queryKey, SearchCandidate, SearchErrorCode, SearchResponse, SiteResults } from "../lib/search";
import { searchNovels, SearchError } from "../lib/api";
import { extractNovelSlug } from "../lib/storage";
import { NOVEL_SITES } from "../lib/sites";
import { SearchIcon } from "./Icons";

interface SearchState {
  query: string;
  // The Chinese names the AI guessed for the query; `picked` is the one searched
  candidates: SearchCandidate[];
  picked: number;
  response: SearchResponse | null;
  error: SearchErrorCode | "failed" | null;
}

const EMPTY: SearchState = { query: "", candidates: [], picked: 0, response: null, error: null };

// The last search, shown again when the panel is reopened (for this visit only)
let lastSearch: SearchState = EMPTY;

// Recent searches, so searching the same name again is instant and free
const CACHE_KEY = "novel-translator-search-cache";
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_SIZE = 20;

type CachedSearches = Record<string, { at: number; response: SearchResponse }>;

function readCache(): CachedSearches {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return cache && typeof cache === "object" ? cache : {};
  } catch {
    return {};
  }
}

function cachedSearch(key: string): SearchResponse | null {
  const entry = readCache()[key];
  return entry && Date.now() - entry.at < CACHE_TTL_MS && Array.isArray(entry.response?.sites) ? entry.response : null;
}

function cacheSearch(key: string, response: SearchResponse) {
  const fresh = Object.entries(readCache()).filter(([k, entry]) => k !== key && Date.now() - entry.at < CACHE_TTL_MS);
  const kept = fresh.sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_SIZE - 1);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries([[key, { at: Date.now(), response }], ...kept])));
  } catch {
    // Storage full: chapters matter more than this cache
  }
}

// A site's first results; the rest behind "show more"
const SHOWN_PER_SITE = 5;

interface Props {
  t: Translations;
  textColor: string;
  // The OpenAI key: searching uses a fixed OpenAI model (see SEARCH_AI_MODEL)
  apiKey: string;
  // Saved chapters per novel slug: those novels open where the reader left off
  library: Map<string, number>;
  autoFocus?: boolean;
  onOpen: (novel: FoundNovel) => void;
}

// Finding a novel on the supported sites by its name, in Vietnamese or Chinese
export default function NovelSearch({ t, textColor, apiKey, library, autoFocus, onOpen }: Props) {
  const [state, setState] = useState<SearchState>(lastSearch);
  const [searching, setSearching] = useState(false);
  // Sites whose every result is shown
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    lastSearch = state;
  }, [state]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Searches the typed name, or else one of the names guessed for it
  async function search(picked?: number) {
    const query = state.query.trim();
    if (!query) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const candidate = picked === undefined ? undefined : state.candidates[picked];
    // A picked guess by all it searches with: the same title by another author is another search
    const key = candidate ? `zh:${JSON.stringify(candidate)}` : `q:${queryKey(query)}`;
    const fresh = picked === undefined ? { candidates: [], picked: 0 } : { picked };
    setExpanded(new Set());

    const cached = cachedSearch(key);
    if (cached) {
      setSearching(false);
      setState((s) => ({ ...s, ...fresh, response: cached, error: null, ...(picked === undefined ? { candidates: cached.candidates } : {}) }));
      return;
    }
    setSearching(true);
    setState((s) => ({ ...s, ...fresh, response: null, error: null }));
    try {
      const response = await searchNovels({ query, candidate, apiKey }, controller.signal);
      if (controller.signal.aborted) return;
      // Not when a site failed or a name is untranslated (no key, AI error): better next time
      const complete = response.sites.every((site) => !site.failed && site.results.every((novel) => novel.titleVi && (novel.authorVi || !novel.author)));
      if (complete) cacheSearch(key, response);
      setState((s) => ({ ...s, response, ...(picked === undefined ? { candidates: response.candidates } : {}) }));
    } catch (e) {
      if (controller.signal.aborted) return;
      setState((s) => ({ ...s, error: e instanceof SearchError && e.code ? e.code : "failed" }));
    }
    setSearching(false);
  }

  const muted = textColor + "80";
  const { response, candidates, picked, error } = state;
  const errors: Record<SearchErrorCode | "failed", string> = {
    needKey: t.searchNeedKey,
    badKey: t.searchBadKey,
    aiFailed: t.searchAiFailed,
    invalid: t.searchFailed,
    failed: t.searchFailed,
  };
  const guess = candidates[picked];
  const others = candidates.map((c, i) => ({ c, i })).filter(({ i }) => i !== picked);
  const nothingFound = !!response && response.sites.every((site) => !site.failed && site.results.length === 0);

  function siteSection({ site, results, failed }: SiteResults) {
    const label = NOVEL_SITES.find((s) => s.domain === site)?.label;
    const shown = expanded.has(site) ? results : results.slice(0, SHOWN_PER_SITE);
    return (
      <section key={site} aria-label={site} className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-2 text-xs font-medium" style={{ color: textColor + "b0" }}>
          {site}
          {label && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: textColor + "15", color: textColor + "90" }}>
              {label}
            </span>
          )}
          {!failed && <span style={{ color: muted }}>· {t.searchCount.replace("{n}", String(results.length))}</span>}
        </h3>
        {failed ? (
          <p className="text-xs px-3 py-2 rounded-lg border" style={{ color: "#d97706", borderColor: textColor + "20" }}>
            {t.searchSiteFailed}
          </p>
        ) : results.length === 0 ? (
          <p className="text-xs px-3 py-2 rounded-lg border" style={{ color: muted, borderColor: textColor + "20" }}>
            {t.searchSiteEmpty}
          </p>
        ) : (
          <ul className="flex flex-col rounded-lg border divide-y" style={{ borderColor: textColor + "20" }}>
            {shown.map((novel) => {
              const saved = library.get(extractNovelSlug(novel.url)) ?? 0;
              const details = [
                novel.authorVi || novel.author,
                novel.status === "completed" ? t.statusCompleted : novel.status === "ongoing" ? t.statusOngoing : "",
              ].filter(Boolean);
              return (
                <li key={novel.url} style={{ borderColor: textColor + "15" }}>
                  <button
                    onClick={() => onOpen(novel)}
                    className="w-full text-left px-3 py-2.5 cursor-pointer hover:opacity-70 transition-opacity"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-medium truncate">{novel.titleVi || novel.title}</span>
                      {novel.titleVi && (
                        <span lang="zh" className="text-xs truncate shrink-0 max-w-[40%]" style={{ color: muted }}>
                          {novel.title}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 mt-0.5 text-xs" style={{ color: muted }}>
                      <span className="truncate">{details.join(" · ")}</span>
                      {saved > 0 && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded" style={{ backgroundColor: "#3b82f620", color: "#3b82f6" }}>
                          {t.inLibrary.replace("{n}", String(saved))}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {results.length > shown.length && (
              <li style={{ borderColor: textColor + "15" }}>
                <button
                  onClick={() => setExpanded((sites) => new Set(sites).add(site))}
                  className="w-full px-3 py-2 text-xs cursor-pointer hover:opacity-70"
                  style={{ color: "#3b82f6" }}
                >
                  {t.searchShowMore.replace("{n}", String(results.length - shown.length))}
                </button>
              </li>
            )}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!searching) search();
        }}
      >
        <input
          type="search"
          enterKeyHint="search"
          autoFocus={autoFocus}
          data-autofocus={autoFocus || undefined}
          value={state.query}
          onChange={(e) => {
            const query = e.target.value;
            if (query.trim()) return setState((s) => ({ ...s, query }));
            // Emptied (its ✕ button, or every letter deleted): the last search goes too
            abortRef.current?.abort();
            setSearching(false);
            setExpanded(new Set());
            setState({ ...EMPTY, query });
          }}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
          maxLength={100}
          className="flex-1 min-w-0 px-3 py-2.5 rounded-lg border text-sm"
          style={{ backgroundColor: "transparent", borderColor: textColor + "30", color: textColor }}
        />
        <button
          type="submit"
          disabled={searching || !state.query.trim()}
          className="shrink-0 px-4 py-2.5 cursor-pointer bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 whitespace-nowrap"
        >
          <SearchIcon />
          {t.search}
        </button>
      </form>

      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {searching && (
          <p className="text-sm animate-pulse" style={{ color: muted }}>
            {t.searching}
          </p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "#dc2626" }}>
            {errors[error]}
          </p>
        )}
        {guess && !searching && (response || error) && (
          <p className="text-xs" style={{ color: muted }}>
            {t.searchedFor}: <span lang="zh">{guess.title}</span>
            {guess.author && <span lang="zh"> · {guess.author}</span>}
            {others.length > 0 && (
              <>
                {" "}
                · {t.searchOthers}:{" "}
                {others.map(({ c, i }) => (
                  <button
                    key={i}
                    onClick={() => search(i)}
                    lang="zh"
                    className="underline cursor-pointer hover:opacity-70 mr-2"
                  >
                    {c.title}
                  </button>
                ))}
              </>
            )}
          </p>
        )}
        {nothingFound && !searching && (
          <p className="text-sm" style={{ color: muted }}>
            {t.searchNoResults}
          </p>
        )}
      </div>

      {response && !searching && !nothingFound && <div className="flex flex-col gap-4">{response.sites.map(siteSection)}</div>}
    </div>
  );
}
