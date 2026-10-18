"use client";

import { SavedChapter } from "../lib/types";
import { Translations } from "../lib/i18n";

interface NovelInfo {
  slug: string;
  name: string;
  chapterCount: number;
  lastRead: number;
}

interface Props {
  chapters: SavedChapter[];
  textColor: string;
  currentNovelSlug: string | null;
  t: Translations;
  onSelectNovel: (slug: string) => void;
  onClearNovel: (slug: string) => void;
}

function getNovelName(chapters: SavedChapter[]): string {
  return chapters[0]?.novelName || chapters[0]?.novelSlug || "Unknown";
}

function getNovels(chapters: SavedChapter[]): NovelInfo[] {
  const map = new Map<string, SavedChapter[]>();
  for (const ch of chapters) {
    const slug = ch.novelSlug || "unknown";
    if (!map.has(slug)) map.set(slug, []);
    map.get(slug)!.push(ch);
  }

  return Array.from(map.entries()).map(([slug, chs]) => ({
    slug,
    name: getNovelName(chs),
    chapterCount: chs.length,
    lastRead: Math.max(...chs.map((c) => c.savedAt)),
  })).sort((a, b) => b.lastRead - a.lastRead);
}

export default function SavedNovelsList({
  chapters,
  textColor,
  currentNovelSlug,
  t,
  onSelectNovel,
  onClearNovel,
}: Props) {
  const novels = getNovels(chapters);

  if (novels.length === 0) {
    return (
      <p className="p-4 text-center text-sm" style={{ color: textColor + "60" }}>
        {t.noNovels}
      </p>
    );
  }

  return (
    <ul>
      {novels.map((novel) => {
        const isActive = novel.slug === currentNovelSlug;
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
              <p className="text-xs" style={{ color: textColor + "60" }}>
                {novel.chapterCount} {t.chapters.toLowerCase()}
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
  );
}
