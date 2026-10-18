"use client";

import { useRef, useState } from "react";
import { GlossaryTerm, TERM_KINDS, TermKind } from "../lib/types";
import { termKey } from "../lib/glossary";
import { Translations } from "../lib/i18n";
import Switch from "./Switch";

export function kindLabel(kind: TermKind, t: Translations): string {
  const labels: Record<TermKind, string> = {
    character: t.kindCharacter,
    place: t.kindPlace,
    organization: t.kindOrganization,
    skill: t.kindSkill,
    item: t.kindItem,
    other: t.kindOther,
  };
  return labels[kind];
}

export interface TermChange {
  target: string;
  kind: TermKind;
  gender?: "male" | "female";
}

interface Props {
  terms: GlossaryTerm[];
  textColor: string;
  bgColor: string;
  t: Translations;
  // Null while no chapter is open
  novelSlug: string | null;
  // The automatic glossary is on (a setting for every novel)
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  // Scanning saved chapters needs an API key and saved chapters
  canScan: boolean;
  scanChapters: number;
  // Progress of a running scan
  scan: { done: number; total: number } | null;
  // Result of the last scan or import
  message: string | null;
  onChange: (term: GlossaryTerm, change: TermChange) => void;
  onDelete: (term: GlossaryTerm) => void;
  onClearAll: () => void;
  onScan: () => void;
  onStopScan: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

// The names of the open novel: automatic, but each can be corrected
export default function GlossaryPanel({
  terms,
  textColor,
  bgColor,
  t,
  novelSlug,
  enabled,
  onToggle,
  canScan,
  scanChapters,
  scan,
  message,
  onChange,
  onDelete,
  onClearAll,
  onScan,
  onStopScan,
  onExport,
  onImport,
}: Props) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const muted = textColor + "80";
  const inputStyle = { backgroundColor: bgColor, borderColor: textColor + "30", color: textColor };
  const smallButton = "px-2.5 py-1.5 rounded-md border text-xs cursor-pointer hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed";

  const toggle = (
    <Switch
      label={t.autoGlossary}
      checked={enabled}
      onChange={onToggle}
      textColor={textColor}
      note={enabled ? t.namesHint : t.glossaryOff}
    />
  );

  if (!novelSlug) {
    return (
      <div className="flex flex-col gap-3">
        {toggle}
        <p className="p-4 text-center text-sm" style={{ color: textColor + "60" }}>
          {t.namesNoNovel}
        </p>
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const shown = terms
    .filter(
      (term) =>
        !query ||
        term.target.toLowerCase().includes(query) ||
        term.source.includes(search.trim()) ||
        term.aliases?.some((a) => a.toLowerCase().includes(query))
    )
    .sort(
      (a, b) => TERM_KINDS.indexOf(a.kind) - TERM_KINDS.indexOf(b.kind) || a.target.localeCompare(b.target, "vi")
    );

  return (
    <div className="flex flex-col gap-3">
      {toggle}

      <div className="flex flex-wrap gap-2">
        {scan ? (
          <button onClick={onStopScan} className={smallButton} style={{ borderColor: textColor + "30" }}>
            <span className="animate-pulse">{t.scanning.replace("{done}", String(scan.done)).replace("{total}", String(scan.total))}</span>
            {" · "}
            {t.stop}
          </button>
        ) : (
          <button
            onClick={onScan}
            disabled={!canScan || !enabled}
            title={t.scanNamesNote.replace("{n}", String(scanChapters))}
            className={smallButton}
            style={{ borderColor: textColor + "30" }}
          >
            {t.scanNames}
          </button>
        )}
        <button onClick={onExport} disabled={terms.length === 0} className={smallButton} style={{ borderColor: textColor + "30" }}>
          {t.exportNames}
        </button>
        <button onClick={() => fileRef.current?.click()} className={smallButton} style={{ borderColor: textColor + "30" }}>
          {t.importNames}
        </button>
        <button
          onClick={() => {
            if (window.confirm(t.confirmClearNames.replace("{n}", String(terms.length)))) onClearAll();
          }}
          disabled={terms.length === 0 || !!scan}
          className={smallButton + " text-red-500"}
          style={{ borderColor: "#ef444460" }}
        >
          {t.clearAllNames}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.target.value = "";
          }}
        />
      </div>
      {message && (
        <p role="status" className="text-xs" style={{ color: muted }}>
          {message}
        </p>
      )}

      {terms.length === 0 ? (
        <p className="p-4 text-center text-sm" style={{ color: textColor + "60" }}>
          {t.namesEmpty}
        </p>
      ) : (
        <>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchNames}
            aria-label={t.searchNames}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ ...inputStyle, borderColor: textColor + "20" }}
          />
          <ul className="flex flex-col">
            {shown.map((term) => {
              const key = termKey(term);
              return (
                <li key={key} className="border-b last:border-b-0" style={{ borderColor: textColor + "12" }}>
                  {editing === key ? (
                    <TermEditor
                      term={term}
                      t={t}
                      textColor={textColor}
                      inputStyle={inputStyle}
                      onSave={(change) => {
                        onChange(term, change);
                        setEditing(null);
                      }}
                      onDelete={() => {
                        onDelete(term);
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-2 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{term.target}</p>
                        <p className="text-xs truncate" style={{ color: muted }}>
                          {[
                            term.source,
                            kindLabel(term.kind, t),
                            term.gender === "male" ? t.genderMale : term.gender === "female" ? t.genderFemale : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <button
                        onClick={() => setEditing(key)}
                        className="shrink-0 px-2.5 py-1 rounded-md text-xs cursor-pointer hover:opacity-70"
                        style={{ color: "#3b82f6" }}
                        aria-label={`${t.edit} ${term.target}`}
                      >
                        {t.edit}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function TermEditor({
  term,
  t,
  textColor,
  inputStyle,
  onSave,
  onDelete,
  onCancel,
}: {
  term: GlossaryTerm;
  t: Translations;
  textColor: string;
  inputStyle: React.CSSProperties;
  onSave: (change: TermChange) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(term.target);
  const [kind, setKind] = useState<TermKind>(term.kind);
  const [gender, setGender] = useState<"" | "male" | "female">(term.gender ?? "");
  const field = "w-full px-2.5 py-1.5 rounded-md border text-sm";
  const label = "text-xs block mb-1";

  return (
    <form
      className="flex flex-col gap-2 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const name = target.trim();
        if (name) onSave({ target: name, kind, gender: kind === "character" && gender ? gender : undefined });
      }}
      onKeyDown={(e) => {
        // Close just the editor, not the drawer around it
        if (e.key === "Escape") {
          e.nativeEvent.stopImmediatePropagation();
          onCancel();
        }
      }}
    >
      {term.source && (
        <p className="text-xs" style={{ color: textColor + "80" }}>
          {t.originalName}: {term.source}
        </p>
      )}
      <input
        autoFocus
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        maxLength={60}
        aria-label={t.names}
        className={field}
        style={inputStyle}
      />
      <div className="flex gap-2">
        <label className="flex-1 min-w-0">
          <span className={label} style={{ color: textColor + "80" }}>{t.kind}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as TermKind)} className={field} style={inputStyle}>
            {TERM_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k, t)}
              </option>
            ))}
          </select>
        </label>
        {kind === "character" && (
          <label className="flex-1 min-w-0">
            <span className={label} style={{ color: textColor + "80" }}>{t.gender}</span>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as "" | "male" | "female")}
              className={field}
              style={inputStyle}
            >
              <option value="">{t.genderUnknown}</option>
              <option value="male">{t.genderMale}</option>
              <option value="female">{t.genderFemale}</option>
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDelete}
          className="px-3 py-1.5 text-xs text-red-500 hover:text-red-700 cursor-pointer mr-auto"
        >
          {t.clear}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs cursor-pointer hover:opacity-70">
          {t.cancel}
        </button>
        <button
          type="submit"
          disabled={!target.trim()}
          className="px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        >
          {t.save}
        </button>
      </div>
    </form>
  );
}
