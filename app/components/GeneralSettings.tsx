"use client";

import { ReaderSettings } from "../lib/types";
import { Translations } from "../lib/i18n";
import DisplaySettings from "./DisplaySettings";
import Switch from "./Switch";

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

      <Switch
        label={t.autoClearNovels}
        checked={settings.autoClearNovels}
        onChange={(autoClearNovels) => onUpdate({ autoClearNovels })}
        textColor={textColor}
      />

      <div className="border-t pt-5" style={{ borderColor: textColor + "15" }}>
        <p className="text-sm font-semibold mb-4">{t.display}</p>
        <DisplaySettings settings={settings} textColor={textColor} t={t} onUpdate={onUpdate} />
      </div>
    </div>
  );
}
