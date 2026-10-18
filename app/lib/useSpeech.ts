"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SpeechEngine } from "./types";
import { AI_SEGMENT_CHARS, cursorAt, DEVICE_SEGMENT_CHARS, indexAt, segmentAt, SpeechCursor, speechSegments } from "./speech";

// Reads the open chapter aloud, piece by piece (see speech.ts), with the
// device's own voices (speechSynthesis) or OpenAI's (/api/tts, played in an
// <audio> element, which keeps playing with the screen off).

// "waiting": for the chapter text (being translated, or the next chapter
// opening); "buffering": for an AI voice clip
export type SpeechStatus = "off" | "playing" | "paused" | "buffering" | "waiting";
export type SpeechError = "unsupported" | "noVoice" | "needKey" | "badKey" | "rateLimited" | "failed";
// Stops reading at a time, or at the end of the chapter
export type SleepTimer = { minutes: number; until: number } | "chapter" | null;

interface Params {
  // The open chapter's URL; empty when none is open
  chapterKey: string;
  text: string;
  // The chapter is still being translated (its text keeps growing)
  loading: boolean;
  engine: SpeechEngine;
  deviceVoice: string;
  aiVoice: string;
  rate: number;
  openaiApiKey: string;
  // For the lock screen
  title: string;
  novelName: string;
  // Where reading starts: the paragraph at the top of the screen
  firstVisibleParagraph: () => number;
  // The chapter was read to its end: open the next one (true) or not (false)
  onChapterEnd: () => boolean;
  onError: (error: SpeechError) => void;
}

// Clips fetched ahead of the one playing, so pieces follow without a gap
const PREFETCH_CLIPS = 2;

function isVietnamese(voice: SpeechSynthesisVoice): boolean {
  return voice.lang.toLowerCase().replace("_", "-").startsWith("vi");
}

// The device's Vietnamese voices, natural-sounding (online) ones first
export function vietnameseVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const rank = (v: SpeechSynthesisVoice) => (/natural|online|neural/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : 2);
  return window.speechSynthesis
    .getVoices()
    .filter(isVietnamese)
    .sort((a, b) => rank(a) - rank(b));
}

// The device's Vietnamese voices, updated when the browser finishes loading them
export function useDeviceVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const update = () => setVoices(vietnameseVoices());
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

class ClipError extends Error {
  code: SpeechError;

  constructor(code: SpeechError) {
    super(code);
    this.name = "ClipError";
    this.code = code;
  }
}

async function fetchClip(text: string, voice: string, apiKey: string, signal: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, text, voice }),
      signal,
    });
    if (res.ok) return URL.createObjectURL(await res.blob());
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    throw new ClipError(res.status === 401 ? "badKey" : res.status === 429 ? "rateLimited" : "failed");
  }
}

// A short silent sound, played on the user's tap so the browser (iOS) lets
// the clips play later without one
let silence: string | null = null;
function silentClip(): string {
  if (silence) return silence;
  const samples = 800;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  silence = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  return silence;
}

export function useSpeech(params: Params) {
  const { chapterKey, text, loading, engine, deviceVoice, aiVoice, rate } = params;
  const [status, setStatusState] = useState<SpeechStatus>("off");
  const [cursor, setCursor] = useState<SpeechCursor>({ paragraph: 0, piece: 0 });
  const [sleep, setSleep] = useState<SleepTimer>(null);
  const [now, setNow] = useState(() => Date.now());

  const segments = useMemo(
    () => speechSegments(text, engine === "ai" ? AI_SEGMENT_CHARS : DEVICE_SEGMENT_CHARS, !loading),
    [text, engine, loading]
  );

  // Latest values, for callbacks that outlive a render
  const p = useRef(params);
  p.current = params;
  const segmentsRef = useRef(segments);
  const statusRef = useRef<SpeechStatus>("off");
  const sleepRef = useRef<SleepTimer>(null);
  sleepRef.current = sleep;
  // The piece being read; -1 for "where the reader is" (a chapter opened while paused)
  const indexRef = useRef(0);
  // The same place, which stays put when the pieces change
  const cursorRef = useRef<SpeechCursor>({ paragraph: 0, piece: 0 });
  if (segmentsRef.current !== segments) {
    // Another voice's piece length, a name rewritten, more text translated:
    // the pieces are renumbered, not the place being read
    segmentsRef.current = segments;
    if (indexRef.current >= 0) indexRef.current = indexAt(segments, cursorRef.current);
  }
  // Bumped whenever playback stops or moves: callbacks of an older one are ignored
  const generationRef = useRef(0);
  // Start once the chapter has text (it is opening or being translated)
  const pendingStartRef = useRef(false);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read to the end of what is translated so far: go on when more arrives
  const waitingMoreRef = useRef(false);
  // The chapter read to its end, while the next one opens
  const endedChapterRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The clip loaded in the audio element (see clipKey)
  const loadedClipRef = useRef<string | null>(null);
  const clipsRef = useRef(new Map<number, { key: string; url: Promise<string> }>());
  const clipAbortRef = useRef(new AbortController());

  function setStatus(next: SpeechStatus) {
    statusRef.current = next;
    setStatusState(next);
  }

  function setIndex(i: number) {
    indexRef.current = i;
    cursorRef.current = cursorAt(segmentsRef.current, i);
    setCursor(cursorRef.current);
  }

  // Play starts from where the reader is (nothing highlighted until then)
  function startFromReader() {
    indexRef.current = -1;
    cursorRef.current = { paragraph: Number.MAX_SAFE_INTEGER, piece: 0 };
    setCursor(cursorRef.current);
  }

  function cancelStart() {
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    startTimerRef.current = null;
  }

  function audio(): HTMLAudioElement {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
    }
    return audioRef.current;
  }

  function silenceOutput() {
    // Not when idle: Safari may then drop the next utterance
    if ("speechSynthesis" in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    audioRef.current?.pause();
  }

  function dropClips() {
    clipAbortRef.current.abort();
    clipAbortRef.current = new AbortController();
    for (const { url } of clipsRef.current.values()) url.then(URL.revokeObjectURL, () => {});
    clipsRef.current.clear();
    loadedClipRef.current = null;
  }

  function clipKey(i: number): string {
    return `${p.current.aiVoice}\n${segmentsRef.current[i]?.text}`;
  }

  function clip(i: number): Promise<string> {
    const segment = segmentsRef.current[i];
    const voice = p.current.aiVoice;
    const key = clipKey(i);
    const cached = clipsRef.current.get(i);
    if (cached?.key === key) return cached.url;
    cached?.url.then(URL.revokeObjectURL, () => {});
    const url = fetchClip(segment.text, voice, p.current.openaiApiKey, clipAbortRef.current.signal);
    clipsRef.current.set(i, { key, url });
    // A failed clip is fetched again next time
    url.catch(() => {
      if (clipsRef.current.get(i)?.url === url) clipsRef.current.delete(i);
    });
    return url;
  }

  // Fetches the next clips and lets go of the ones already played
  function prefetchAfter(i: number) {
    for (const [k, entry] of clipsRef.current) {
      if (k < i - 1 || k > i + PREFETCH_CLIPS + 2) {
        entry.url.then(URL.revokeObjectURL, () => {});
        clipsRef.current.delete(k);
      }
    }
    for (let k = i + 1; k <= i + PREFETCH_CLIPS && k < segmentsRef.current.length; k++) clip(k).catch(() => {});
  }

  function fail(error: SpeechError) {
    generationRef.current++;
    silenceOutput();
    setStatus("paused");
    p.current.onError(error);
  }

  function playAt(i: number) {
    const generation = ++generationRef.current;
    silenceOutput();
    const segments = segmentsRef.current;
    if (i >= segments.length) {
      if (p.current.loading && p.current.chapterKey) {
        // Caught up with the translation
        setIndex(i);
        waitingMoreRef.current = true;
        setStatus("waiting");
      } else {
        chapterEnded();
      }
      return;
    }
    waitingMoreRef.current = false;
    setIndex(i);
    if (p.current.engine === "device") speakDevice(i, generation);
    else playClip(i, generation);
  }

  function speakDevice(i: number, generation: number) {
    const all = window.speechSynthesis.getVoices();
    const voices = vietnameseVoices();
    // An empty list may just not be loaded yet: let the browser pick by language
    if (all.length > 0 && voices.length === 0) return fail("noVoice");
    const voice = voices.find((v) => v.voiceURI === p.current.deviceVoice) ?? voices[0];
    const utterance = new SpeechSynthesisUtterance(segmentsRef.current[i].text);
    utterance.lang = voice?.lang ?? "vi-VN";
    if (voice) utterance.voice = voice;
    utterance.rate = p.current.rate;
    utterance.onend = () => {
      if (generation === generationRef.current) playAt(indexRef.current + 1);
    };
    utterance.onerror = (e) => {
      if (generation !== generationRef.current || e.error === "interrupted" || e.error === "canceled") return;
      fail(e.error === "not-allowed" ? "unsupported" : "failed");
    };
    // Kept referenced: Chrome may otherwise drop it before it ends
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setStatus("playing");
  }

  function playClip(i: number, generation: number) {
    setStatus("buffering");
    const player = audio();
    clip(i)
      .then((url) => {
        if (generation !== generationRef.current) return;
        player.src = url;
        loadedClipRef.current = clipKey(i);
        return startAudio(generation).then(() => {
          if (generation === generationRef.current) prefetchAfter(i);
        });
      })
      .catch((e: unknown) => {
        if (generation !== generationRef.current || (e instanceof Error && e.name === "AbortError")) return;
        fail(e instanceof ClipError ? e.code : "failed");
      });
  }

  // Plays (or resumes) the loaded clip
  function startAudio(generation: number): Promise<void> {
    const player = audio();
    player.defaultPlaybackRate = p.current.rate;
    player.playbackRate = p.current.rate;
    player.onended = () => {
      if (generation === generationRef.current) playAt(indexRef.current + 1);
    };
    return player.play().then(
      () => {
        if (generation === generationRef.current) setStatus("playing");
      },
      (e: unknown) => {
        if (generation !== generationRef.current) return;
        // Not started by a tap (some browsers): wait for one
        if (e instanceof Error && e.name === "NotAllowedError") setStatus("paused");
        else throw e;
      }
    );
  }

  function chapterEnded() {
    setIndex(segmentsRef.current.length);
    endedChapterRef.current = p.current.chapterKey;
    if (sleepRef.current === "chapter") {
      setSleep(null);
      setStatus("paused");
    } else if (p.current.onChapterEnd()) {
      pendingStartRef.current = true;
      setStatus("waiting");
    } else {
      setStatus("paused");
    }
  }

  // Must run in the tap that starts reading: browsers only let a page start
  // sound in response to one
  function unlock(): boolean {
    if (p.current.engine === "ai") {
      if (!p.current.openaiApiKey.trim()) {
        p.current.onError("needKey");
        return false;
      }
      const player = audio();
      if (loadedClipRef.current === null) {
        player.src = silentClip();
        player.play().catch(() => {});
      }
      return true;
    }
    if (!("speechSynthesis" in window)) {
      p.current.onError("unsupported");
      return false;
    }
    // Reading starts later (the chapter is still loading): start a silent one now
    if (statusRef.current === "off" && segmentsRef.current.length === 0) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    }
    return true;
  }

  function startHere() {
    const segments = segmentsRef.current;
    if (segments.length === 0) {
      pendingStartRef.current = true;
      setStatus("waiting");
      return;
    }
    playAt(segmentAt(segments, p.current.firstVisibleParagraph()));
  }

  function start() {
    if (statusRef.current !== "off" || !unlock()) return;
    startHere();
  }

  function pause() {
    const current = statusRef.current;
    if (current === "off" || current === "paused") return;
    generationRef.current++;
    cancelStart();
    pendingStartRef.current = false;
    waitingMoreRef.current = false;
    if (p.current.engine === "device") silenceOutput();
    else audioRef.current?.pause();
    setStatus("paused");
  }

  function resume() {
    if (statusRef.current !== "paused" || !unlock()) return;
    const i = indexRef.current;
    if (i < 0) return startHere();
    if (p.current.engine === "ai" && loadedClipRef.current === clipKey(i) && audioRef.current && !audioRef.current.ended) {
      const generation = ++generationRef.current;
      setStatus("buffering");
      startAudio(generation).catch(() => {
        if (generation === generationRef.current) fail("failed");
      });
      return;
    }
    playAt(i);
  }

  function toggle() {
    if (statusRef.current === "paused") resume();
    else pause();
  }

  function stop() {
    generationRef.current++;
    silenceOutput();
    dropClips();
    cancelStart();
    pendingStartRef.current = false;
    waitingMoreRef.current = false;
    setSleep(null);
    setStatus("off");
  }

  // Moves by a paragraph
  function skip(delta: 1 | -1) {
    const segments = segmentsRef.current;
    if (segments.length === 0 || statusRef.current === "off") return;
    const current = Math.min(Math.max(indexRef.current, 0), segments.length - 1);
    const paragraph = segments[current].paragraph;
    let target: number;
    if (delta > 0) {
      target = segmentAt(segments, paragraph + 1);
    } else {
      const first = segmentAt(segments, paragraph);
      target = current > first || first === 0 ? first : segmentAt(segments, segments[first - 1].paragraph);
    }
    if (statusRef.current === "paused") setIndex(Math.min(target, segments.length - 1));
    else playAt(target);
  }

  // Reads from a paragraph the user tapped
  function seekParagraph(paragraph: number) {
    if (statusRef.current === "off") return;
    const target = segmentAt(segmentsRef.current, paragraph);
    if (target >= segmentsRef.current.length) return;
    if (statusRef.current === "paused" && !unlock()) return;
    playAt(target);
  }

  // Another chapter opened (or the novel was deleted)
  const shownChapter = useRef(chapterKey);
  useEffect(() => {
    if (shownChapter.current === chapterKey) return;
    shownChapter.current = chapterKey;
    endedChapterRef.current = null;
    if (statusRef.current === "off") return;
    if (!chapterKey) return stop();
    generationRef.current++;
    silenceOutput();
    dropClips();
    cancelStart();
    waitingMoreRef.current = false;
    if (statusRef.current === "paused") {
      pendingStartRef.current = false;
      startFromReader();
    } else {
      pendingStartRef.current = true;
      setStatus("waiting");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterKey]);

  // The chapter has text to read now, or more of it
  useEffect(() => {
    if (statusRef.current !== "waiting") return;
    if (pendingStartRef.current) {
      // (Not the chapter just finished, if the next one has not opened yet)
      if (endedChapterRef.current === chapterKey) return;
      if (segments.length > 0) {
        // After a saved chapter's scroll position is restored
        startTimerRef.current ??= setTimeout(() => {
          startTimerRef.current = null;
          if (statusRef.current !== "waiting" || !pendingStartRef.current) return;
          pendingStartRef.current = false;
          startHere();
        }, 300);
      } else if (!loading && chapterKey) {
        // It opened (or failed) with nothing to read
        pendingStartRef.current = false;
        startFromReader();
        setStatus("paused");
      }
      return;
    }
    if (waitingMoreRef.current && (segments.length > indexRef.current || !loading)) playAt(indexRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, loading, status, chapterKey]);

  // Another voice: go on from the same paragraph with it
  const voiceKey = `${engine}\n${deviceVoice}\n${aiVoice}`;
  const shownVoice = useRef(voiceKey);
  useEffect(() => {
    if (shownVoice.current === voiceKey) return;
    shownVoice.current = voiceKey;
    if (statusRef.current === "off") return;
    // (While waiting, the place to go on from is kept as it is)
    if (statusRef.current === "waiting") return dropClips();
    generationRef.current++;
    silenceOutput();
    dropClips();
    // From the start of the paragraph: the pieces have another length now
    const target = indexAt(segmentsRef.current, { paragraph: cursorRef.current.paragraph, piece: 0 });
    if (statusRef.current === "playing" || statusRef.current === "buffering") playAt(target);
    else if (indexRef.current >= 0) setIndex(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceKey]);

  useEffect(() => {
    if (statusRef.current === "off") return;
    if (engine === "ai") {
      if (audioRef.current) audioRef.current.playbackRate = audioRef.current.defaultPlaybackRate = rate;
    } else if (statusRef.current === "playing") {
      // A device voice takes the speed when it starts a piece
      playAt(indexRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  // Sleep timer
  useEffect(() => {
    if (!sleep || sleep === "chapter") return;
    const tick = () => {
      setNow(Date.now());
      if (Date.now() >= sleep.until) {
        setSleep(null);
        pause();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleep]);

  // Lock screen and headset controls
  const handlers = useRef({ resume, pause, skip, stop });
  handlers.current = { resume, pause, skip, stop };
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (status === "off") {
      session.metadata = null;
      session.playbackState = "none";
      return;
    }
    session.playbackState = status === "paused" ? "paused" : "playing";
    const actions: [MediaSessionAction, () => void][] = [
      ["play", () => handlers.current.resume()],
      ["pause", () => handlers.current.pause()],
      ["previoustrack", () => handlers.current.skip(-1)],
      ["nexttrack", () => handlers.current.skip(1)],
      ["stop", () => handlers.current.stop()],
    ];
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Not supported by this browser
      }
    }
  }, [status]);
  useEffect(() => {
    if (!("mediaSession" in navigator) || status === "off") return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: params.title, artist: params.novelName });
  }, [status === "off", params.title, params.novelName]); // eslint-disable-line react-hooks/exhaustive-deps

  // A device voice stops when the screen turns off: keep it on while reading
  const keepAwake = engine === "device" && (status === "playing" || status === "waiting");
  useEffect(() => {
    if (!keepAwake || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(
        (l) => {
          if (released) l.release().catch(() => {});
          else lock = l;
        },
        () => {}
      );
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [keepAwake]);

  useEffect(
    () => () => {
      generationRef.current++;
      cancelStart();
      silenceOutput();
      dropClips();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const index = indexAt(segments, cursor);
  return {
    status,
    // The paragraph being read, highlighted in the chapter
    paragraph: status !== "off" && status !== "waiting" && index < segments.length ? segments[index].paragraph : null,
    position: index,
    total: segments.length,
    sleep,
    sleepLeft: sleep && sleep !== "chapter" ? sleep.until - now : null,
    setSleep,
    start,
    stop,
    toggle,
    skip,
    seekParagraph,
  };
}
