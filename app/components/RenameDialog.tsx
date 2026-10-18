"use client";

import { useState } from "react";
import Sheet from "./Sheet";
import { Translations } from "../lib/i18n";

interface Props {
  // The name as selected in the chapter
  from: string;
  // Its original text, when the glossary knows it
  source?: string;
  t: Translations;
  textColor: string;
  bgColor: string;
  onRename: (to: string) => void;
  onClose: () => void;
}

// Corrects a name selected in the chapter, in every chapter of the novel
export default function RenameDialog({ from, source, t, textColor, bgColor, onRename, onClose }: Props) {
  const [to, setTo] = useState(from);
  const name = to.trim();

  return (
    <Sheet side="center" title={t.renameName} closeLabel={t.close} textColor={textColor} bgColor={bgColor} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name && name !== from) onRename(name);
          else onClose();
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm">
            {t.renameTo.replace("{name}", from)}
            {source && (
              <span className="ml-1" style={{ color: textColor + "80" }}>
                ({source})
              </span>
            )}
          </span>
          <input
            autoFocus
            data-autofocus
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onFocus={(e) => e.target.select()}
            maxLength={60}
            className="w-full px-3 py-2.5 rounded-lg border text-sm"
            style={{ backgroundColor: "transparent", borderColor: textColor + "30", color: textColor }}
          />
        </label>
        <p className="text-xs" style={{ color: textColor + "80" }}>
          {t.renameNote}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm cursor-pointer hover:opacity-70">
            {t.cancel}
          </button>
          <button
            type="submit"
            disabled={!name}
            className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            {t.save}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
