"use client";

import { SPEECH_RATES } from "../lib/types";
import { Translations } from "../lib/i18n";
import { formatRemaining } from "../lib/speech";
import { SleepTimer, SpeechStatus } from "../lib/useSpeech";
import { CloseIcon, PauseIcon, PlayIcon, SettingsIcon, SkipBackIcon, SkipForwardIcon, TimerIcon } from "./Icons";

// Sleep timer choices, in turn: off → 15 → 30 → 60 minutes → end of chapter → off
const SLEEP_MINUTES = [15, 30, 60];

interface Props {
  status: SpeechStatus;
  position: number;
  total: number;
  rate: number;
  sleep: SleepTimer;
  sleepLeft: number | null;
  textColor: string;
  bgColor: string;
  t: Translations;
  onToggle: () => void;
  onSkip: (delta: 1 | -1) => void;
  onStop: () => void;
  onRate: (rate: number) => void;
  onSleep: (sleep: SleepTimer) => void;
  onSettings: () => void;
}

// The read-aloud controls, along the bottom of the screen
export default function SpeechPlayer({
  status,
  position,
  total,
  rate,
  sleep,
  sleepLeft,
  textColor,
  bgColor,
  t,
  onToggle,
  onSkip,
  onStop,
  onRate,
  onSleep,
  onSettings,
}: Props) {
  const paused = status === "paused";
  const busy = status === "buffering" || status === "waiting";
  const label =
    status === "waiting"
      ? t.speechWaiting
      : status === "buffering"
        ? t.speechBuffering
        : t.speechParagraph.replace("{i}", String(Math.min(position + 1, total))).replace("{n}", String(total)) +
          (paused ? ` · ${t.speechPaused}` : "");
  const sleepLabel = sleep === "chapter" ? t.sleepChapter : sleepLeft !== null ? formatRemaining(sleepLeft) : null;

  function nextSleep() {
    if (sleep === "chapter") return onSleep(null);
    const minutes = sleep ? SLEEP_MINUTES[SLEEP_MINUTES.indexOf(sleep.minutes) + 1] : SLEEP_MINUTES[0];
    onSleep(minutes ? { minutes, until: Date.now() + minutes * 60_000 } : "chapter");
  }

  const iconButton = "w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:opacity-70 shrink-0";

  return (
    <div
      role="region"
      aria-label={t.readAloud}
      className="fixed bottom-0 inset-x-0 z-30 border-t shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
      style={{ backgroundColor: bgColor, borderColor: textColor + "20", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-md mx-auto px-3 pt-1.5 pb-2">
        <p className={"truncate text-center text-xs" + (busy ? " animate-pulse" : "")} style={{ color: textColor + "a0" }} aria-live="polite">
          {label}
        </p>
        <div className="flex items-center justify-between gap-1 mt-1">
          <button onClick={onStop} className={iconButton} aria-label={t.stopReading} title={t.stopReading}>
            <CloseIcon />
          </button>
          <button
            onClick={nextSleep}
            className="h-10 min-w-10 px-1.5 rounded-full flex items-center justify-center gap-1 text-xs cursor-pointer hover:opacity-70 shrink-0"
            style={{ color: sleepLabel ? "#3b82f6" : undefined }}
            aria-label={`${t.sleepTimer}: ${sleepLabel ?? t.sleepOff}`}
            title={t.sleepTimer}
          >
            <TimerIcon />
            {sleepLabel && <span className="tabular-nums">{sleepLabel}</span>}
          </button>
          <button onClick={() => onSkip(-1)} className={iconButton} aria-label={t.prevParagraph} title={t.prevParagraph}>
            <SkipBackIcon />
          </button>
          <button
            onClick={onToggle}
            className="w-12 h-12 rounded-full flex items-center justify-center cursor-pointer text-white bg-blue-600 hover:bg-blue-700 shrink-0"
            aria-label={t.playPause}
            title={t.playPause}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button onClick={() => onSkip(1)} className={iconButton} aria-label={t.nextParagraph} title={t.nextParagraph}>
            <SkipForwardIcon />
          </button>
          <button
            onClick={() => onRate(SPEECH_RATES[(SPEECH_RATES.indexOf(rate) + 1) % SPEECH_RATES.length])}
            className="h-10 min-w-10 px-1 rounded-full text-sm font-medium cursor-pointer hover:opacity-70 shrink-0 tabular-nums"
            aria-label={`${t.speechSpeed} ${rate}×`}
            title={t.speechSpeed}
          >
            {rate}×
          </button>
          <button onClick={onSettings} className={iconButton} aria-label={t.speechSettings} title={t.speechSettings}>
            <SettingsIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
