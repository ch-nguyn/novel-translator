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
    <div
      className="mb-4 rounded-lg border overflow-hidden"
      style={{ borderColor: textColor + "20" }}
    >
      <div
        className="p-3 border-b"
        style={{ borderColor: textColor + "10" }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchChapter}
          className="w-full px-3 py-2 rounded border text-sm"
          style={{
            backgroundColor: settings.bgColor,
            borderColor: textColor + "20",
            color: textColor,
          }}
        />
      </div>
      <div className="max-h-60 sm:max-h-64 overflow-auto">
        {filtered.length === 0 ? (
          <p
            className="p-4 text-center text-sm"
            style={{ color: textColor + "60" }}
          >
            {t.noChapters}
          </p>
        ) : (
          filtered.map((ch) => {
            const isActive = ch.url === currentUrl;
            return (
            <div
              key={ch.url}
              className="flex items-center px-3 sm:px-4 py-3 border-b last:border-b-0"
              style={{
                borderColor: textColor + "10",
                backgroundColor: isActive ? "#3b82f6" + "20" : "transparent",
                borderLeft: isActive ? "3px solid #3b82f6" : "3px solid transparent",
              }}
            >
              <button
                onClick={() => onLoad(ch)}
                className="text-left flex-1 cursor-pointer rounded-lg px-2 py-1 transition-colors hover:opacity-70"
              >
                <p className="text-sm font-medium truncate" style={{ color: isActive ? "#3b82f6" : undefined }}>{ch.title}</p>
                <p className="text-xs" style={{ color: textColor + "60" }}>
                  {new Date(ch.savedAt).toLocaleString()}
                </p>
              </button>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
