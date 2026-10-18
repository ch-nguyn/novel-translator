"use client";

import { useEffect, useRef, useState } from "react";
import { ReaderSettings, AI_MODEL_OPTIONS, REASONING_EFFORT_OPTIONS, ReasoningEffort, getProviderForModel, isOpenAIReasoningModel } from "../lib/types";
import { Translations } from "../lib/i18n";
import Switch from "./Switch";

interface Props {
  settings: ReaderSettings;
  // Translating on the app's key: the model and key below are not used
  systemAI?: boolean;
  textColor: string;
  t: Translations;
  onUpdate: (patch: Partial<ReaderSettings>) => void;
}

export default function AISettingsPanel({ settings, systemAI, textColor, t, onUpdate }: Props) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const inputStyle = {
    backgroundColor: "transparent",
    borderColor: textColor + "30",
    color: textColor,
  };

  const provider = getProviderForModel(settings.aiModel);
  const keyFieldMap: Record<string, "openaiApiKey" | "geminiApiKey" | "claudeApiKey" | "openrouterApiKey"> = {
    gemini: "geminiApiKey",
    claude: "claudeApiKey",
    openrouter: "openrouterApiKey",
    openai: "openaiApiKey",
  };
  const labelMap: Record<string, string> = {
    gemini: t.geminiApiKey,
    claude: t.claudeApiKey,
    openrouter: t.openrouterApiKey,
    openai: t.openaiApiKey,
  };
  const keyField = keyFieldMap[provider] || "openaiApiKey";
  const label = labelMap[provider] || t.openaiApiKey;

  const effortLabelMap: Record<ReasoningEffort, string> = {
    low: t.reasoningLow,
    medium: t.reasoningMedium,
    high: t.reasoningHigh,
    xhigh: t.reasoningExtraHigh,
  };
  const isChatGPT = isOpenAIReasoningModel(settings.aiModel);

  useEffect(() => {
    if (!modelMenuOpen) return;

    function closeModelMenu(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && !modelPickerRef.current?.contains(target)) {
        setModelMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeModelMenu);
    return () => document.removeEventListener("mousedown", closeModelMenu);
  }, [modelMenuOpen]);

  function updateModel(model: string) {
    onUpdate({ aiModel: model });
    setModelMenuOpen(false);
  }

  return (
    <div className="flex flex-col gap-5">
      {systemAI && (
        <p className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: textColor + "10" }}>
          {t.systemAINote}
        </p>
      )}
      <div>
        <label className="text-sm font-medium block mb-2">{t.aiModel}</label>
        <div
          ref={modelPickerRef}
          className="relative"
          onKeyDown={(e) => {
            // Close just the list, not the settings drawer around it. React
            // listens on the document too, so stop the drawer's listener there.
            if (e.key === "Escape" && modelMenuOpen) {
              e.nativeEvent.stopImmediatePropagation();
              setModelMenuOpen(false);
            }
          }}
        >
          <div className="flex">
            <input
              role="combobox"
              aria-expanded={modelMenuOpen}
              aria-controls="openai-model-options"
              value={settings.aiModel}
              onFocus={() => setModelMenuOpen(true)}
              onChange={(e) => {
                const model = e.target.value;
                onUpdate({ aiModel: model });
                setModelMenuOpen(true);
              }}
              placeholder={t.aiModelPlaceholder}
              className="w-full px-3 py-2 rounded-l border text-sm"
              style={inputStyle}
            />
            <button
              type="button"
              aria-label={t.aiModel}
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              onClick={() => setModelMenuOpen((open) => !open)}
              className="px-3 rounded-r border border-l-0 text-sm cursor-pointer hover:opacity-70"
              style={inputStyle}
            >
              ▾
            </button>
          </div>
          {modelMenuOpen && (
            <div
              id="openai-model-options"
              role="listbox"
              className="absolute left-0 right-0 z-20 mt-1 rounded border shadow-lg overflow-hidden"
              style={{
                backgroundColor: textColor === "#d4d4d4" || textColor === "#cccccc" ? "#1a1a2e" : "#ffffff",
                borderColor: textColor + "30",
              }}
            >
              {AI_MODEL_OPTIONS.flatMap((group) => group.models).map((model) => (
                <button
                  key={model}
                  type="button"
                  role="option"
                  aria-selected={settings.aiModel === model}
                  onClick={() => updateModel(model)}
                  className="block w-full px-3 py-2 text-left text-sm cursor-pointer hover:opacity-70"
                  style={{
                    backgroundColor: settings.aiModel === model ? textColor + "15" : "transparent",
                    color: textColor,
                  }}
                >
                  {model}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium block mb-2">{label}</label>
        <input
          type="password"
          value={settings[keyField]}
          onChange={(e) => onUpdate({ [keyField]: e.target.value })}
          placeholder={t.apiKeyPlaceholder}
          className="w-full px-3 py-2 rounded-lg border text-sm"
          style={inputStyle}
        />
        <p className="text-xs mt-1" style={{ color: textColor + "50" }}>
          {t.apiKeyNote}
        </p>
      </div>

      <Switch
        label={t.autoGlossary}
        checked={settings.autoGlossary}
        onChange={(autoGlossary) => onUpdate({ autoGlossary })}
        textColor={textColor}
        note={t.autoGlossaryNote}
      />

      {isChatGPT && <div>
        <label className="text-sm font-medium block mb-2">{t.reasoningEffort}</label>
        <select
          value={settings.reasoningEffort}
          onChange={(e) => onUpdate({ reasoningEffort: e.target.value as ReasoningEffort })}
          className="w-full px-3 py-2 rounded-lg border text-sm"
          style={inputStyle}
        >
          {REASONING_EFFORT_OPTIONS.map((effort) => (
            <option key={effort} value={effort}>
              {effortLabelMap[effort]}
            </option>
          ))}
        </select>
        <p className="text-xs mt-1" style={{ color: textColor + "50" }}>
          {t.reasoningEffortNote}
        </p>
      </div>}

      <div>
        <label className="text-sm font-medium block mb-2">{t.customPrompt}</label>
        <textarea
          value={settings.customPrompt}
          onChange={(e) => onUpdate({ customPrompt: e.target.value })}
          placeholder={t.customPromptPlaceholder}
          rows={4}
          className="w-full px-3 py-2 rounded-lg border text-sm resize-y"
          style={inputStyle}
        />
      </div>
    </div>
  );
}
