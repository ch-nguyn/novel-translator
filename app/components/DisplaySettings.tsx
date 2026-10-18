"use client";

import { ReaderSettings, BG_OPTIONS } from "../lib/types";
import { Translations } from "../lib/i18n";

interface Props {
  settings: ReaderSettings;
  textColor: string;
  t: Translations;
  onUpdate: (patch: Partial<ReaderSettings>) => void;
}

// Background, font size and line spacing of the chapter text
export default function DisplaySettings({ settings, textColor, t, onUpdate }: Props) {
  const stepButton = "w-9 h-9 rounded-lg border flex items-center justify-center cursor-pointer transition-colors hover:opacity-70";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="text-sm font-medium block mb-2">{t.background}</label>
        <div className="flex flex-wrap gap-2">
          {BG_OPTIONS.map((opt) => (
            <button
              key={opt.bg}
              onClick={() => onUpdate({ bgColor: opt.bg })}
              className="w-10 h-10 rounded-full border-2 transition-all cursor-pointer hover:opacity-80"
              style={{
                backgroundColor: opt.bg,
                borderColor: settings.bgColor === opt.bg ? "#3b82f6" : textColor + "20",
                transform: settings.bgColor === opt.bg ? "scale(1.1)" : "scale(1)",
              }}
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={settings.bgColor === opt.bg}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium block mb-2">
          {t.fontSize}: {settings.fontSize}px
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onUpdate({ fontSize: Math.max(12, settings.fontSize - 2) })}
            className={stepButton}
            style={{ borderColor: textColor + "30" }}
            aria-label={`${t.fontSize} -`}
          >
            A-
          </button>
          <input
            type="range"
            min={12}
            max={32}
            step={1}
            value={settings.fontSize}
            onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value, 10) })}
            className="flex-1"
            aria-label={t.fontSize}
          />
          <button
            onClick={() => onUpdate({ fontSize: Math.min(32, settings.fontSize + 2) })}
            className={stepButton}
            style={{ borderColor: textColor + "30" }}
            aria-label={`${t.fontSize} +`}
          >
            A+
          </button>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium block mb-2">
          {t.lineSpacing}: {settings.lineSpacing}
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onUpdate({ lineSpacing: Math.max(1, +(settings.lineSpacing - 0.2).toFixed(1)) })}
            className={stepButton}
            style={{ borderColor: textColor + "30" }}
            aria-label={`${t.lineSpacing} -`}
          >
            -
          </button>
          <input
            type="range"
            min={1}
            max={3}
            step={0.2}
            value={settings.lineSpacing}
            onChange={(e) => onUpdate({ lineSpacing: parseFloat(e.target.value) })}
            className="flex-1"
            aria-label={t.lineSpacing}
          />
          <button
            onClick={() => onUpdate({ lineSpacing: Math.min(3, +(settings.lineSpacing + 0.2).toFixed(1)) })}
            className={stepButton}
            style={{ borderColor: textColor + "30" }}
            aria-label={`${t.lineSpacing} +`}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
