"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SavedChapter } from "../lib/types";
import { Translations } from "../lib/i18n";
import { extractNovelSlug, getNovelUpdates, recordNovelToc } from "../lib/storage";
import { fetchNovelToc, NovelToc, readableTocTitle, tocChapterNumber, translateTocTitles } from "../lib/toc";

// Chapters shown at once; a long novel is picked by range
const PAGE_SIZE = 100;

interface Props {
  // A chapter of the novel (or its page)
  novelUrl: string;
  // The novel's saved chapters
  chapters: SavedChapter[];
  currentUrl: string | null;
  openaiApiKey: string;
  canNavigate: (url: string) => boolean;
  textColor: string;
  bgColor: string;
  t: Translations;
  onOpen: (url: string) => void;
}

// Every chapter the novel's site lists, marked translated / being read
export default function ChapterDirectory({ novelUrl, chapters, currentUrl, openaiApiKey, canNavigate, textColor, bgColor, t, onOpen }: Props) {
  const [toc, setToc] = useState<NovelToc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const [page, setPage] = useState<number | null>(null);
  const [jump, setJump] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetchNovelToc(novelUrl, { signal: controller.signal, fresh: loads > 0 })
      .then((loaded) => {
        setToc(loaded);
        const slug = extractNovelSlug(novelUrl);
        const last = loaded.chapters[loaded.chapters.length - 1];
        // A list kept from earlier must not undo a newer check that found more
        const known = getNovelUpdates()[slug]?.total ?? 0;
        if (last && loaded.chapters.length > known) recordNovelToc(slug, loaded.chapters.length, last.title);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, [novelUrl, loads]);

  const saved = useMemo(() => new Map(chapters.map((c) => [c.url, c])), [chapters]);
  const currentIndex = toc && currentUrl ? toc.chapters.findIndex((c) => c.url === currentUrl) : -1;
  const pages = toc ? Math.max(1, Math.ceil(toc.chapters.length / PAGE_SIZE)) : 1;
  // Opens on the part with the chapter being read
  const shownPage = page ?? Math.max(0, Math.floor(currentIndex / PAGE_SIZE));
  const shown = toc ? toc.chapters.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE) : [];

  // Titles of the part shown, in Vietnamese (saved chapters have theirs)
  useEffect(() => {
    const untranslated = shown.filter((c) => !saved.has(c.url)).map((c) => c.title);
    if (untranslated.length === 0) return;
    const controller = new AbortController();
    translateTocTitles(untranslated, openaiApiKey, controller.signal)
      .then((found) => setTitles((prev) => new Map([...prev, ...found])))
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toc, shownPage, openaiApiKey]);

  // The chapter being read, or the one jumped to, is scrolled into view
  const target = highlight ?? currentUrl;
  useEffect(() => {
    if (!target) return;
    listRef.current?.querySelector(`[data-url="${CSS.escape(target)}"]`)?.scrollIntoView({ block: "center" });
  }, [target, toc, shownPage]);

  function jumpTo(value: string) {
    const number = parseInt(value, 10);
    if (!toc || isNaN(number)) return;
    let index = toc.chapters.findIndex((c) => tocChapterNumber(c.title) === number);
    if (index < 0 && number >= 1 && number <= toc.chapters.length) index = number - 1;
    setNotFound(index < 0);
    if (index < 0) return;
    setPage(Math.floor(index / PAGE_SIZE));
    setHighlight(toc.chapters[index].url);
  }

  if (error) {
    return (
      <div className="p-4 text-center text-sm" style={{ color: textColor + "99" }}>
        <p>{t.tocFailed}</p>
        <p className="text-xs mt-1" style={{ color: textColor + "60" }}>{error}</p>
        <button onClick={() => setLoads((n) => n + 1)} className="mt-3 px-3 py-1.5 rounded-lg border text-sm cursor-pointer" style={{ borderColor: textColor + "30" }}>
          {t.retry}
        </button>
      </div>
    );
  }
  if (!toc) {
    return <p className="p-4 text-center text-sm animate-pulse" style={{ color: textColor + "60" }}>{t.tocLoading}</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="search"
          inputMode="numeric"
          value={jump}
          onChange={(e) => {
            setJump(e.target.value);
            setNotFound(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && jumpTo(jump)}
          placeholder={t.tocJump}
          aria-label={t.tocJump}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border text-sm"
          style={{ backgroundColor: bgColor, borderColor: textColor + "20", color: textColor }}
        />
        {pages > 1 && (
          <select
            value={shownPage}
            onChange={(e) => {
              setPage(Number(e.target.value));
              setHighlight(null);
            }}
            aria-label={t.tocPart}
            className="px-2 py-2 rounded-lg border text-sm cursor-pointer"
            style={{ backgroundColor: bgColor, borderColor: textColor + "20", color: textColor }}
          >
            {Array.from({ length: pages }, (_, i) => (
              <option key={i} value={i}>
                {i * PAGE_SIZE + 1}–{Math.min((i + 1) * PAGE_SIZE, toc.chapters.length)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center justify-between px-1 mb-1 text-xs" style={{ color: textColor + "80" }}>
        <span role={notFound ? "alert" : undefined}>
          {notFound ? t.tocNotFound.replace("{n}", jump) : t.tocCount.replace("{n}", String(toc.chapters.length))}
        </span>
        <button onClick={() => setLoads((n) => n + 1)} className="cursor-pointer hover:underline">
          {t.tocReload}
        </button>
      </div>
      <ul ref={listRef}>
        {shown.map((chapter, i) => {
          const index = shownPage * PAGE_SIZE + i;
          const savedChapter = saved.get(chapter.url);
          const isCurrent = chapter.url === currentUrl;
          const isTarget = chapter.url === highlight;
          const read = currentIndex >= 0 && index < currentIndex;
          const openable = canNavigate(chapter.url);
          return (
            <li key={chapter.url} data-url={chapter.url}>
              <button
                onClick={() => onOpen(chapter.url)}
                disabled={!openable}
                aria-current={isCurrent ? "true" : undefined}
                title={openable ? chapter.title : t.needApiKey}
                className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg cursor-pointer transition-colors hover:opacity-70 disabled:cursor-not-allowed disabled:hover:opacity-100"
                style={{
                  backgroundColor: isCurrent ? "#3b82f620" : isTarget ? textColor + "12" : "transparent",
                  opacity: read && !isCurrent ? 0.55 : openable ? 1 : 0.45,
                }}
              >
                <span className="w-10 shrink-0 text-xs tabular-nums" style={{ color: textColor + "60" }}>{index + 1}</span>
                <span className="flex-1 min-w-0 text-sm truncate" style={{ color: isCurrent ? "#3b82f6" : undefined }}>
                  {savedChapter?.title || titles.get(chapter.title) || readableTocTitle(chapter.title)}
                </span>
                {savedChapter && (
                  <span className="shrink-0 text-xs" style={{ color: "#16a34a" }} title={t.tocSaved} aria-label={t.tocSaved}>
                    ✓
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
