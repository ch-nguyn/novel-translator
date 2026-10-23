"use client";

import { ChapterRecap, GlossaryTerm, TermNote } from "../lib/types";
import { Translations } from "../lib/i18n";
import { kindLabel } from "./GlossaryPanel";

// What the app remembers of a novel for its reader (see app/lib/recaps.ts and
// TermNote): who a name is, and what happened in the last chapters.

// A name selected in the chapter: who or what it is, as far as the reader has read
export function NameCard({
  term,
  notes,
  t,
  bgColor,
  textColor,
}: {
  term: GlossaryTerm;
  notes: TermNote[];
  t: Translations;
  bgColor: string;
  textColor: string;
}) {
  const muted = textColor + "99";
  return (
    <div
      className="w-full rounded-xl shadow-lg border p-3 text-left text-sm"
      style={{ backgroundColor: bgColor, color: textColor, borderColor: textColor + "26" }}
    >
      <p className="font-semibold">
        {term.target}
        <span className="font-normal text-xs" style={{ color: muted }}>
          {" · "}
          {[kindLabel(term.kind, t), term.gender === "male" ? t.genderMale : term.gender === "female" ? t.genderFemale : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </p>
      {notes.length > 0 ? (
        <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
          {notes.map((note, i) => (
            <li key={i}>
              {note.text}
              {note.chapter && (
                <span className="block text-xs truncate" style={{ color: muted }}>
                  {note.chapter}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs" style={{ color: muted }}>
          {t.nameNoNotes}
        </p>
      )}
    </div>
  );
}

// What happened in the chapters before the one open, for a reader coming back to the novel
export function RecapCard({
  recaps,
  t,
  textColor,
  onClose,
}: {
  recaps: ChapterRecap[];
  t: Translations;
  textColor: string;
  onClose: () => void;
}) {
  return (
    <section className="mb-4 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: textColor + "26", backgroundColor: textColor + "08" }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t.recapTitle}</h2>
        <button onClick={onClose} className="px-2 py-0.5 rounded-md text-xs cursor-pointer hover:opacity-70" style={{ color: "#3b82f6" }}>
          {t.close}
        </button>
      </div>
      <ol className="mt-2 space-y-2">
        {recaps.map((recap) => (
          <li key={recap.url}>
            <span className="block text-xs truncate" style={{ color: textColor + "99" }}>
              {recap.title}
            </span>
            {recap.summary}
          </li>
        ))}
      </ol>
    </section>
  );
}
