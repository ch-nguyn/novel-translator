"use client";

import { AI_VOICES, ReaderSettings, SpeechEngine, SPEECH_RATES } from "../lib/types";
import { Translations } from "../lib/i18n";
import { useDeviceVoices } from "../lib/useSpeech";

interface Props {
  settings: ReaderSettings;
  textColor: string;
  t: Translations;
  onUpdate: (patch: Partial<ReaderSettings>) => void;
}

// The voice chapters are read aloud with
export default function SpeechSettings({ settings, textColor, t, onUpdate }: Props) {
  const voices = useDeviceVoices();
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const muted = textColor + "80";
  const field = "w-full px-3 py-2 rounded-lg border text-sm";
  const fieldStyle = { backgroundColor: "transparent", borderColor: textColor + "30", color: textColor };
  const engines: { id: SpeechEngine; label: string; note: string }[] = [
    { id: "device", label: t.engineDevice, note: t.engineDeviceNote },
    { id: "ai", label: t.engineAi, note: t.engineAiNote },
  ];

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-2">{t.speechEngine}</legend>
        {engines.map((engine) => {
          const selected = settings.speechEngine === engine.id;
          return (
            <label
              key={engine.id}
              className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer"
              style={{ borderColor: selected ? "#3b82f6" : textColor + "20" }}
            >
              <input
                type="radio"
                name="speech-engine"
                checked={selected}
                onChange={() => onUpdate({ speechEngine: engine.id })}
                className="mt-1"
              />
              <span>
                <span className="text-sm font-medium block">{engine.label}</span>
                <span className="text-xs block mt-0.5" style={{ color: muted }}>
                  {engine.note}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {settings.speechEngine === "device" ? (
        <div>
          <label htmlFor="speech-voice" className="text-sm font-medium block mb-2">
            {t.deviceVoice}
          </label>
          {voices.length > 0 ? (
            <select
              id="speech-voice"
              value={voices.some((v) => v.voiceURI === settings.speechVoice) ? settings.speechVoice : voices[0].voiceURI}
              onChange={(e) => onUpdate({ speechVoice: e.target.value })}
              className={field}
              style={fieldStyle}
            >
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs" style={{ color: "#dc2626" }}>
              {supported ? t.noVietnameseVoice : t.speechUnsupported}
            </p>
          )}
        </div>
      ) : (
        <div>
          <label htmlFor="speech-ai-voice" className="text-sm font-medium block mb-2">
            {t.aiVoice}
          </label>
          <select
            id="speech-ai-voice"
            value={settings.speechAiVoice}
            onChange={(e) => onUpdate({ speechAiVoice: e.target.value })}
            className={field}
            style={fieldStyle}
          >
            {AI_VOICES.map((voice) => (
              <option key={voice} value={voice}>
                {voice[0].toUpperCase() + voice.slice(1)}
              </option>
            ))}
          </select>
          {!settings.openaiApiKey.trim() && (
            <p className="text-xs mt-2" style={{ color: "#dc2626" }}>
              {t.speechNeedKey}
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="speech-rate" className="text-sm font-medium block mb-2">
          {t.speechSpeed}
        </label>
        <select
          id="speech-rate"
          value={settings.speechRate}
          onChange={(e) => onUpdate({ speechRate: parseFloat(e.target.value) })}
          className={field}
          style={fieldStyle}
        >
          {SPEECH_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs" style={{ color: muted }}>
        {t.speechTapHint}
      </p>
    </div>
  );
}
