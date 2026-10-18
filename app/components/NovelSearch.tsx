"use client";

import { useEffect, useRef, useState } from "react";
import { Translations } from "../lib/i18n";
import { FoundNovel, SearchCandidate, SearchErrorCode, SearchResponse } from "../lib/search";
import { searchNovels, SearchError, translateTitles } from "../lib/api";
import { extractNovelSlug } from "../lib/storage";
import { SearchIcon } from "./Icons";

interface SearchState {
  query: string;
  // The Chinese names the AI guessed for the query; `picked` is the one searched
  candidates: SearchCandidate[];
  picked: number;
  response: SearchResponse | null;
  // Titles and authors in Sino-Vietnamese, by their Chinese text
  names: Record<string, string>;
  error: SearchErrorCode | "failed" | null;
}

const EMPTY: SearchState = { query: "", candidates: [], picked: 0, response: null, names: {}, error: null };

// The last search, shown again when the panel is reopened (for this visit only)
let lastSearch: SearchState = EMPTY;

interface Props {
  t: Translations;
  textColor: string;
  apiKey: string;
  model: string;
  // Saved chapters per novel slug: those novels open where the reader left off
  library: Map<string, number>;
  autoFocus?: boolean;
  onOpen: (novel: FoundNovel) => void;
}

// Finding a novel on the supported sites by its name, in Vietnamese or Chinese
export default function NovelSearch({ t, textColor, apiKey, model, library, autoFocus, onOpen }: Props) {
  const [state, setState] = useState<SearchState>(lastSearch);
  const [searching, setSearching] = useState(false);
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
    setSearching(true);
    setState((s) => ({ ...s, response: null, error: null, ...(picked === undefined ? { candidates: [], picked: 0, names: {} } : { picked }) }));
    try {
      const response = await searchNovels({ query, candidate, apiKey, model }, controller.signal);
      if (controller.signal.aborted) return;
      setState((s) => ({ ...s, response, ...(picked === undefined ? { candidates: response.candidates } : {}) }));
      setSearching(false);
      translateNames(response, controller.signal);
    } catch (e) {
      if (controller.signal.aborted) return;
      setState((s) => ({ ...s, error: e instanceof SearchError && e.code ? e.code : "failed" }));
      setSearching(false);
    }
  }

  // The results' titles and authors in Sino-Vietnamese, after they are shown
  async function translateNames(response: SearchResponse, signal: AbortSignal) {
    if (!apiKey.trim()) return;
    const texts = [...new Set(response.results.flatMap((novel) => [novel.title, novel.author]).filter(Boolean))];
    if (texts.length === 0) return;
    const translated = await translateTitles(texts, apiKey, model);
    if (signal.aborted) return;
    const names: Record<string, string> = {};
    texts.forEach((text, i) => {
      const name = translated[i]?.trim();
      // Left untranslated when the call failed
      if (name && name !== text) names[text] = name;
    });
    setState((s) => ({ ...s, names: { ...s.names, ...names } }));
  }

  const muted = textColor + "80";
  const { response, candidates, picked, names, error } = state;
  const errors: Record<SearchErrorCode | "failed", string> = {
    needKey: t.searchNeedKey,
    badKey: t.searchBadKey,
    aiFailed: t.searchAiFailed,
    invalid: t.searchFailed,
    failed: t.searchFailed,
  };
  const guess = candidates[picked];
  const others = candidates.map((c, i) => ({ c, i })).filter(({ i }) => i !== picked);

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
          onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
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
        {response && !searching && response.failedSites.length > 0 && (
          <p className="text-xs" style={{ color: "#d97706" }}>
            {t.searchSitesFailed.replace("{sites}", response.failedSites.join(", "))}
          </p>
        )}
        {response && !searching && response.results.length === 0 && (
          <p className="text-sm" style={{ color: muted }}>
            {t.searchNoResults}
          </p>
        )}
      </div>

      {response && !searching && response.results.length > 0 && (
        <ul className="flex flex-col rounded-lg border divide-y" style={{ borderColor: textColor + "20" }}>
          {response.results.map((novel) => {
            const saved = library.get(extractNovelSlug(novel.url)) ?? 0;
            const name = names[novel.title];
            const details = [
              names[novel.author] || novel.author,
              novel.status === "completed" ? t.statusCompleted : novel.status === "ongoing" ? t.statusOngoing : "",
              novel.site,
            ].filter(Boolean);
            return (
              <li key={novel.url} style={{ borderColor: textColor + "15" }}>
                <button
                  onClick={() => onOpen(novel)}
                  className="w-full text-left px-3 py-2.5 cursor-pointer hover:opacity-70 transition-opacity"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-medium truncate">{name || novel.title}</span>
                    {name && (
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
        </ul>
      )}
    </div>
  );
}
