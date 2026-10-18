"use client";

import { useRef, useState } from "react";
import { Translations } from "../lib/i18n";
import { exportLibrary, importLibrary } from "../lib/backup";
import { StorageFullError } from "../lib/storage";

interface Props {
  textColor: string;
  t: Translations;
  // Chapters were added to the library
  onRestored: () => void;
}

// Downloading the whole library to a file, and adding a file's back
export default function BackupSettings({ textColor, t, onRestored }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const button = "px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer transition-colors hover:opacity-70";

  async function restore(file: File) {
    setMessage(null);
    try {
      const restored = await importLibrary(file);
      if (!restored) return setMessage(t.backupInvalid);
      onRestored();
      setMessage(t.backupDone.replace("{chapters}", String(restored.chapters)).replace("{novels}", String(restored.novels)));
    } catch (e: unknown) {
      // Part of it may be in (the chapters before the names)
      onRestored();
      setMessage(e instanceof StorageFullError ? t.storageFull : e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold mb-1">{t.backup}</p>
      <p className="text-xs mb-3" style={{ color: textColor + "80" }}>{t.backupNote}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={exportLibrary} className={button} style={{ borderColor: textColor + "30" }}>
          {t.backupExport}
        </button>
        <button onClick={() => fileRef.current?.click()} className={button} style={{ borderColor: textColor + "30" }}>
          {t.backupImport}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) restore(file);
            e.target.value = "";
          }}
        />
      </div>
      {message && (
        <p role="status" className="text-xs mt-2" style={{ color: textColor + "99" }}>
          {message}
        </p>
      )}
    </div>
  );
}
