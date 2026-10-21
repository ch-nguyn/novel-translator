"use client";

import { useRef } from "react";
import { Translations } from "../lib/i18n";
import { NOVEL_SITES } from "../lib/sites";
import { PLAN_OPEN, PLAN_PRICE_VND } from "../lib/plan";
import { formatPrice } from "./SubscriptionPanel";

interface Props {
  t: Translations;
  textColor: string;
  url: string;
  onUrlChange: (url: string) => void;
  onTranslate: () => void;
  onAutoTranslate: () => void;
  autoTranslating: boolean;
  isLoading: boolean;
  buttonLabel: string;
  hasApiKey: boolean;
  onAddApiKey: () => void;
  onSubscribe: () => void;
  autoFocus?: boolean;
}

// The link input with its Translate / Auto buttons and the supported sites
export default function LinkForm({
  t,
  textColor,
  url,
  onUrlChange,
  onTranslate,
  onAutoTranslate,
  autoTranslating,
  isLoading,
  buttonLabel,
  hasApiKey,
  onAddApiKey,
  onSubscribe,
  autoFocus,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canStart = !isLoading && !!url.trim() && hasApiKey;

  return (
    <div className="flex flex-col gap-4">
      <form
        // Links without https:// are fixed up when submitted, so skip the browser's URL check
        noValidate
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canStart && !autoTranslating) onTranslate();
        }}
      >
        <input
          ref={inputRef}
          type="url"
          inputMode="url"
          autoFocus={autoFocus}
          data-autofocus={autoFocus || undefined}
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          // Holds the open chapter's link; selected so a pasted link replaces it
          onFocus={(e) => e.target.select()}
          placeholder={t.pastePlaceholder}
          aria-label={t.pastePlaceholder}
          className="flex-1 px-3 py-2.5 rounded-lg border text-sm min-w-0"
          style={{ backgroundColor: "transparent", borderColor: textColor + "30", color: textColor }}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!canStart || autoTranslating}
            className="flex-1 sm:flex-none px-5 py-2.5 cursor-pointer bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {buttonLabel}
          </button>
          <button
            type="button"
            onClick={onAutoTranslate}
            disabled={!autoTranslating && !canStart}
            className="flex-1 sm:flex-none px-5 py-2.5 cursor-pointer text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            style={{ backgroundColor: autoTranslating ? "#dc2626" : "#16a34a" }}
          >
            {autoTranslating ? t.pause : t.autoTranslate}
          </button>
        </div>
      </form>

      {!hasApiKey && (
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 rounded-lg border text-sm"
          style={{ borderColor: "#f59e0b80", backgroundColor: "#f59e0b14" }}
        >
          <span>{t.needApiKey}</span>
          <span className="flex gap-2 shrink-0">
            {PLAN_OPEN && (
              <button
                onClick={onSubscribe}
                className="px-3 py-1 rounded-md text-xs font-medium cursor-pointer text-white bg-blue-600 hover:bg-blue-700"
              >
                {t.planButton.replace("{price}", formatPrice(PLAN_PRICE_VND))}
              </button>
            )}
            <button
              onClick={onAddApiKey}
              className="px-3 py-1 rounded-md text-xs font-medium cursor-pointer text-white bg-amber-600 hover:bg-amber-700"
            >
              {t.enterApiKey}
            </button>
          </span>
        </div>
      )}

      <div>
        <p className="text-xs font-medium mb-2" style={{ color: textColor + "99" }}>
          {t.supportedSites}
        </p>
        <div className="flex flex-col gap-2">
          {NOVEL_SITES.map(({ domain, homepage, label, sample }) => (
            <div
              key={domain}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border"
              style={{ borderColor: textColor + "20" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <a
                  href={homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium underline hover:opacity-70 truncate"
                >
                  {domain}
                </a>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-mono"
                  style={{ backgroundColor: textColor + "15", color: textColor + "90" }}
                >
                  {label}
                </span>
              </div>
              <button
                onClick={() => {
                  onUrlChange(sample);
                  inputRef.current?.focus();
                }}
                className="text-xs px-2.5 py-1 rounded-md border hover:opacity-70 transition shrink-0 cursor-pointer whitespace-nowrap"
                style={{ borderColor: textColor + "30" }}
              >
                {t.trySample}
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: textColor + "70" }}>
          {t.emptyHint}
        </p>
      </div>
    </div>
  );
}
