"use client";

import { useState } from "react";
import { SavedChapter } from "../lib/types";
import { Translations } from "../lib/i18n";
import { foldAccents } from "../lib/search";
import { Library, NovelUpdate } from "../lib/storage";

// With fewer novels the whole list fits on screen; no filter box
const FILTER_FROM = 5;

interface NovelInfo {
  slug: string;
  name: string;
  // The chapter the reader is on
  chapterTitle: string;
  chapterCount: number;
  lastRead: number;
}

interface Props {
  // The shelf, and the chapters saved on this device
  library: Library;
  chapters: SavedChapter[];
  // What each novel's site listed when last checked
  updates: Record<string, NovelUpdate>;
  checking: boolean;
  onCheck: () => void;
  textColor: string;
  currentNovelSlug: string | null;
  t: Translations;
  onSelectNovel: (slug: string) => void;
  onClearNovel: (slug: string) => void;
}

// The novels on the shelf, most recently read first; also any with saved
// chapters but no place on the shelf (it could not be stored)
function getNovels(library: Library, chapters: SavedChapter[]): NovelInfo[] {
  const map = new Map<string, SavedChapter[]>();
  for (const ch of chapters) {
    const slug = ch.novelSlug || "unknown";
    if (!map.has(slug)) map.set(slug, []);
    map.get(slug)!.push(ch);
  }
  const novels: NovelInfo[] = [];
  for (const [slug, entry] of Object.entries(library)) {
    if (entry.removed) continue;
    const saved = map.get(slug) ?? [];
    novels.push({
      slug,
      name: entry.name || saved.find((c) => c.novelName)?.novelName || slug,
      chapterTitle: entry.chapterTitle,
      chapterCount: saved.length,
      lastRead: entry.updatedAt,
    });
  }
  for (const [slug, saved] of map) {
    if (library[slug] && !library[slug].removed) continue;
    novels.push({
      slug,
      name: saved.find((c) => c.novelName)?.novelName || slug,
      chapterTitle: "",
      chapterCount: saved.length,
      lastRead: Math.max(...saved.map((c) => c.savedAt)),
    });
  }
  return novels.sort((a, b) => b.lastRead - a.lastRead);
}

export default function SavedNovelsList({
  library,
  chapters,
  updates,
  checking,
  onCheck,
  textColor,
  currentNovelSlug,
  t,
  onSelectNovel,
  onClearNovel,
}: Props) {
  const [filter, setFilter] = useState("");
  const novels = getNovels(library, chapters);
  // Accents optional: "pham nhan" finds "Phàm Nhân Tu Tiên"
  const query = foldAccents(filter.trim());
  const shown = query ? novels.filter((novel) => foldAccents(novel.name).includes(query)) : novels;

  if (novels.length === 0) {
    return (
      <p className="p-4 text-center text-sm" style={{ color: textColor + "60" }}>
        {t.noNovels}
      </p>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-1">
        <button
          onClick={onCheck}
          disabled={checking}
          className="px-2 py-1 text-xs cursor-pointer hover:underline disabled:cursor-default disabled:no-underline disabled:animate-pulse"
          style={{ color: textColor + "99" }}
        >
          {checking ? t.checkingUpdates : `↻ ${t.checkUpdates}`}
        </button>
      </div>
      {/* Kept while filtering, even if deleting brought the count under the threshold */}
      {(novels.length >= FILTER_FROM || filter) && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t.filterNovels}
          aria-label={t.filterNovels}
          className="w-full px-3 py-2 mb-2 rounded-lg border text-sm"
          style={{ backgroundColor: "transparent", borderColor: textColor + "20", color: textColor }}
        />
      )}
      {shown.length === 0 && (
        <p className="p-4 text-center text-sm" style={{ color: textColor + "60" }}>
          {t.noMatchingNovels}
        </p>
      )}
      <ul>
        {shown.map((novel) => {
          const isActive = novel.slug === currentNovelSlug;
          const update = updates[novel.slug];
          const fresh = update ? update.total - update.seen : 0;
          return (
            <li
              key={novel.slug}
              className="flex items-center gap-2 rounded-lg"
              style={{ backgroundColor: isActive ? "#3b82f620" : "transparent" }}
            >
              <button
                onClick={() => onSelectNovel(novel.slug)}
                aria-current={isActive ? "true" : undefined}
                className="text-left flex-1 min-w-0 cursor-pointer px-3 py-2.5 transition-colors hover:opacity-70"
              >
                <p className="text-sm font-medium truncate" style={{ color: isActive ? "#3b82f6" : undefined }}>
                  {novel.name}
                </p>
                {novel.chapterTitle && (
                  <p className="text-xs truncate" style={{ color: textColor + "99" }}>
                    {t.readingAt.replace("{chapter}", novel.chapterTitle)}
                  </p>
                )}
                <p className="text-xs" style={{ color: textColor + "60" }}>
                  {novel.chapterCount === 0
                    ? t.noChaptersHere + (update ? ` · ${update.total} ${t.chapters.toLowerCase()}` : "")
                    : update
                      ? `${novel.chapterCount} ${t.savedChapters.toLowerCase()} · ${update.total} ${t.chapters.toLowerCase()}`
                      : `${novel.chapterCount} ${t.chapters.toLowerCase()}`}
                  {fresh > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 rounded-full text-[11px] font-medium text-white bg-blue-500">
                      {t.newChapters.replace("{n}", String(fresh))}
                    </span>
                  )}
                </p>
              </button>
              <button
                onClick={() => onClearNovel(novel.slug)}
                className="shrink-0 px-3 py-2 text-xs text-red-500 hover:text-red-700 cursor-pointer transition-colors"
              >
                {t.clear}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
