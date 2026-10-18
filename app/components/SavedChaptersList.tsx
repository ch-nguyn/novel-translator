"use client";

import { useState } from "react";
import { SavedChapter, ReaderSettings } from "../lib/types";
import { extractChapterNumber } from "../lib/storage";
import { Translations } from "../lib/i18n";

interface Props {
  chapters: SavedChapter[];
  settings: ReaderSettings;
  textColor: string;
  currentUrl: string | null;
  t: Translations;
  onLoad: (chapter: SavedChapter) => void;
}

export default function SavedChaptersList({
  chapters,
  settings,
  textColor,
  currentUrl,
  t,
  onLoad,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? chapters.filter((ch) => {
        const searchNum = parseInt(search, 10);
        if (!isNaN(searchNum)) {
          const chNum = extractChapterNumber(ch.title);
          return chNum === searchNum;
        }
        return ch.title.toLowerCase().includes(search.toLowerCase());
      })
    : chapters;

  return (
    <div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t.searchChapter}
        aria-label={t.searchChapter}
        className="w-full px-3 py-2 mb-2 rounded-lg border text-sm"
        style={{
          backgroundColor: settings.bgColor,
          borderColor: textColor + "20",
          color: textColor,
        }}
      />
      {filtered.length === 0 ? (
        <p className="p-4 text-center text-sm" style={{ color: textColor + "60" }}>
          {t.noChapters}
        </p>
      ) : (
        <ul>
          {filtered.map((ch) => {
            const isActive = ch.url === currentUrl;
            return (
              <li key={ch.url}>
                <button
                  onClick={() => onLoad(ch)}
                  aria-current={isActive ? "true" : undefined}
                  className="w-full text-left px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:opacity-70"
                  style={{ backgroundColor: isActive ? "#3b82f620" : "transparent" }}
                >
                  <p className="text-sm font-medium truncate" style={{ color: isActive ? "#3b82f6" : undefined }}>
                    {ch.title}
                  </p>
                  <p className="text-xs" style={{ color: textColor + "60" }}>
                    {new Date(ch.savedAt).toLocaleString()}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
