"use client";

import { ReaderSettings } from "../lib/types";
import { Translations } from "../lib/i18n";
import DisplaySettings from "./DisplaySettings";

interface Props {
  settings: ReaderSettings;
  textColor: string;
  t: Translations;
  onUpdate: (patch: Partial<ReaderSettings>) => void;
}

export default function GeneralSettings({ settings, textColor, t, onUpdate }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="text-sm font-medium block mb-2">{t.language}</label>
        <select
          value={settings.appLang}
          onChange={(e) => onUpdate({ appLang: e.target.value as "en" | "vi" })}
          className="w-full px-3 py-2 rounded-lg border text-sm"
          style={{ backgroundColor: "transparent", borderColor: textColor + "30", color: textColor }}
        >
          <option value="en">English</option>
          <option value="vi">Tiếng Việt</option>
        </select>
      </div>

      <button
        role="switch"
        aria-checked={settings.autoClearNovels}
        onClick={() => onUpdate({ autoClearNovels: !settings.autoClearNovels })}
        className="flex items-center justify-between gap-3 text-left cursor-pointer"
      >
        <span className="text-sm font-medium">{t.autoClearNovels}</span>
        <span
          className="relative w-11 h-6 rounded-full shrink-0 transition-colors duration-200"
          style={{ backgroundColor: settings.autoClearNovels ? "#3b82f6" : textColor + "20" }}
        >
          <span
            className="absolute top-0.5 left-0 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
            style={{ transform: settings.autoClearNovels ? "translateX(22px)" : "translateX(2px)" }}
          />
        </span>
      </button>

      <div className="border-t pt-5" style={{ borderColor: textColor + "15" }}>
        <p className="text-sm font-semibold mb-4">{t.display}</p>
        <DisplaySettings settings={settings} textColor={textColor} t={t} onUpdate={onUpdate} />
      </div>
    </div>
  );
}
