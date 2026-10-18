"use client";

import { Fragment, useState, useRef, useCallback, useEffect, useMemo } from "react";
import { DEFAULT_AI_MODEL, DEFAULT_AI_VOICE, GlossaryTerm, SavedChapter, ReaderSettings, TranslatedChapter, TranslateOptions, getTextColor, getApiKeyForModel, getTranslateOptions } from "./lib/types";
import {
  getSavedChapters,
  updateChapterLinks,
  clearNovelChapters,
  extractNovelSlug,
  getCurrentUrl,
  setCurrentUrl,
  getLastReadUrl,
  getSettings,
  saveSettings,
  getSettingsUpdatedAt,
  getScrollPosition,
  saveScrollPosition,
  getKnownChapters,
  getClearedNovels,
  reviveNovel,
  withStorageLock,
  StorageFullError,
  getPendingWindow,
  clearPendingWindow,
  getGlossary,
  isGlossaryStorageKey,
  getNovelUpdates,
  NovelUpdate,
  MAX_CHAPTERS_PER_NOVEL,
} from "./lib/storage";
import { checkNovelUpdates } from "./lib/toc";
import { applyNames, editTerm, renameTerm, termKey } from "./lib/glossary";
import { exportGlossary, importGlossary, scanSavedChapters, SCAN_CHAPTERS, updateGlossary } from "./lib/glossaryActions";
import { ChapterMeta, fetchChapterContent, fetchFirstChapterUrl, translateChapterDirect } from "./lib/api";
import { bookPageUrl, normalizeEnteredUrl } from "./lib/sites";
import {
  acknowledgeJobChapters,
  backgroundJobsMaybeAvailable,
  discardNovelJobs,
  getJobChapterStatus,
  getLastJobStartAt,
  saveTranslatedChapter,
  startBackgroundJob,
  syncFinishedJobs,
  SyncResult,
  watchJobChapter,
} from "./lib/jobs";
import AISettingsPanel from "./components/AISettingsPanel";
import GeneralSettings from "./components/GeneralSettings";
import DisplaySettings from "./components/DisplaySettings";
import LinkForm from "./components/LinkForm";
import NovelSearch from "./components/NovelSearch";
import { FoundNovel } from "./lib/search";
import SavedChaptersList from "./components/SavedChaptersList";
import ChapterDirectory from "./components/ChapterDirectory";
import AccountPanel from "./components/AccountPanel";
import SavedNovelsList from "./components/SavedNovelsList";
import NavButtons from "./components/NavButtons";
import ContactPanel from "./components/ContactPanel";
import GlossaryPanel, { TermChange } from "./components/GlossaryPanel";
import RenameDialog from "./components/RenameDialog";
import SpeechPlayer from "./components/SpeechPlayer";
import SpeechSettings from "./components/SpeechSettings";
import { SpeechError, useSpeech } from "./lib/useSpeech";
import Sheet, { TabPanel, Tabs } from "./components/Sheet";
import Popover from "./components/Popover";
import { HeadphonesIcon, ListIcon, PlusIcon, SettingsIcon, TypeIcon } from "./components/Icons";
import { getTranslations } from "./lib/i18n";
import { authClient } from "./lib/auth";
import { pushSettings, syncSettings } from "./lib/settingsSync";
import { hasSystemAI, refreshSystemAI, setSystemAI as rememberSystemAI } from "./lib/systemAI";

// New chapters can be translated: on the app's key, or the user's
function canTranslateWith(options: TranslateOptions): boolean {
  return hasSystemAI() || !!options.apiKey.trim();
}

// What is open over the page: the chapter/novel lists, the settings, or a
// header dropdown (new novel link, display options)
type Overlay = "none" | "library" | "settings" | "new" | "display";
type LibraryTab = "chapters" | "names" | "novels";
// The chapters tab: the ones saved on this device, or every chapter the site lists
type ChapterView = "saved" | "toc";
// A settings change is sent to the account this long after the last one
const SETTINGS_PUSH_DELAY_MS = 1000;
// Novels whose sites are asked for new chapters, the most recently read first
const MAX_CHECKED_NOVELS = 20;
type SettingsTab = "ai" | "speech" | "general" | "account" | "contact";

function HeaderButton({
  label,
  icon,
  onClick,
  active,
  textColor,
  showLabel,
  dot,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active: boolean;
  textColor: string;
  showLabel?: boolean;
  // A marker on the icon, e.g. new chapters in the library
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-expanded={active}
      title={label}
      className="relative h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-sm font-medium cursor-pointer transition-colors shrink-0 hover:opacity-70"
      style={{ color: textColor, backgroundColor: active ? textColor + "18" : "transparent" }}
    >
      {icon}
      {dot && <span className="absolute top-1.5 left-6 w-2 h-2 rounded-full bg-blue-500" role="img" aria-label={dot} title={dot} />}
      {showLabel && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}

// Message shown above the chapter text
type Notice =
  | { kind: "error"; message: string }
  // Old chapters were removed because browser storage was full
  | { kind: "evicted"; count: number }
  // A chapter could not be saved even after removing old ones
  | { kind: "storageFull" };

export default function Home() {
  // The link in the form (also the open chapter's, until another is typed)
  const [url, setUrl] = useState("");
  // The chapter shown (or being opened); empty when none is
  const [openUrl, setOpenUrl] = useState("");
  // For async work that finishes later: the chapter shown by then
  const openUrlRef = useRef("");
  openUrlRef.current = openUrl;
  const [simplifiedText, setSimplifiedText] = useState("");
  const [fetching, setFetching] = useState(false);
  const [simplifying, setSimplifying] = useState(false);
  const [title, setTitle] = useState("");
  const [novelName, setNovelName] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [savedChapters, setSavedChapters] = useState<SavedChapter[]>([]);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("chapters");
  const [chapterView, setChapterView] = useState<ChapterView>("saved");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("ai");
  const [headerHidden, setHeaderHidden] = useState(false);
  const [settings, setSettings] = useState<ReaderSettings>({
    bgColor: "#f5f5dc",
    fontSize: 18,
    lineSpacing: 1.8,
    openaiApiKey: "",
    geminiApiKey: "",
    claudeApiKey: "",
    openrouterApiKey: "",
    aiModel: DEFAULT_AI_MODEL,
    customPrompt: "",
    appLang: "vi",
    autoClearNovels: false,
    reasoningEffort: "medium",
    autoGlossary: true,
    speechEngine: "device",
    speechVoice: "",
    speechAiVoice: DEFAULT_AI_VOICE,
    speechRate: 1,
  });
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [autoTranslating, setAutoTranslating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Bumped when the glossary changes without a chapter being saved
  const [glossaryVersion, setGlossaryVersion] = useState(0);
  // A name selected in the chapter, offered for renaming, and the one being renamed
  const [selectedName, setSelectedName] = useState<{ text: string; top: number; left: number } | null>(null);
  const [renameFrom, setRenameFrom] = useState<string | null>(null);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [glossaryMessage, setGlossaryMessage] = useState<string | null>(null);
  // How many chapters each novel's site listed when last checked
  const [novelUpdates, setNovelUpdates] = useState<Record<string, NovelUpdate>>({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const checkingUpdatesRef = useRef(false);
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const sessionId = session?.session.id ?? null;
  // AI calls run on the app's key (see app/lib/systemAI.ts)
  const [systemAI, setSystemAI] = useState(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const settingsPushRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The chapter being fetched/translated on screen. Opening another chapter
  // leaves it translating (and saving) in the background, off screen.
  const abortRef = useRef<AbortController | null>(null);
  // Every chapter translating in this tab, on screen or not, by URL
  const runsRef = useRef(new Map<string, AbortController>());
  // A search result's first-chapter lookup, called off when another chapter opens
  const lookupRef = useRef<AbortController | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const autoModeRef = useRef(false);
  // Bumped when auto mode starts or stops, so a stopped loop still waiting on
  // its last chapter (now off screen) cannot end a newer one
  const autoSessionRef = useRef(0);
  const textRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const t = getTranslations(settings.appLang);

  // The chapter the library and names are about: the open one, not a link being typed
  const libraryUrl = openUrl || url;
  const currentNovelSlug = libraryUrl ? extractNovelSlug(libraryUrl) : null;

  const currentNovelChapters = currentNovelSlug
    ? savedChapters.filter((c) => c.novelSlug === currentNovelSlug)
    : [];

  const glossary = useMemo(
    () => (currentNovelSlug ? getGlossary(currentNovelSlug) : []),
    // Saving a chapter (which updates savedChapters) may add names to the glossary
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentNovelSlug, savedChapters, glossaryVersion]
  );
  // Names first found in the open chapter
  const chapterNewTerms = url ? glossary.filter((term) => term.firstSeen === url) : [];

  useEffect(() => {
    setSavedChapters(getSavedChapters());
    setSettings(getSettings());
    setNovelUpdates(getNovelUpdates());

    const currentUrl = getCurrentUrl();
    const shownAtStart = !!currentUrl && getSavedChapters().some((c) => c.url === currentUrl);
    if (currentUrl) {
      const chapter = getSavedChapters().find((c) => c.url === currentUrl);
      if (chapter) {
        // Also records it as its novel's reading position (kept per novel since this was added)
        markCurrent(chapter.url);
        setUrl(chapter.url);
        setOpenUrl(chapter.url);
        setTitle(chapter.title);
        setNovelName(chapter.novelName || "");
        setChapterName(chapter.title || "");
        setSimplifiedText(chapter.simplifiedText);
        setPrevUrl(chapter.prevUrl || null);
        setNextUrl(chapter.nextUrl || null);
        // Restore scroll position after content renders
        // Use setTimeout to wait for React to render the content
        setTimeout(() => {
          const saved = getScrollPosition(currentUrl);
          if (saved) window.scrollTo(0, saved);
        }, 100);
        refreshChapterLinks(chapter);
      } else {
        setUrl(currentUrl);
      }
    }

    const mountedAt = Date.now();

    // Pull in chapters translated in the background while the app was closed
    syncFinishedJobs().then(async (result) => {
      const isCleared = (u: string) => getClearedNovels().has(extractNovelSlug(u));
      // The user may have deleted the novel or opened another chapter meanwhile
      const stillCurrent = !!currentUrl && getCurrentUrl() === currentUrl && !isCleared(currentUrl);
      let resumed = false;
      if (currentUrl && stillCurrent) {
        const chapter = getSavedChapters().find((c) => c.url === currentUrl);
        if (chapter) {
          // It finished while the app was closed
          if (!shownAtStart) loadSavedChapter(chapter);
        } else {
          const status = await getJobChapterStatus(currentUrl);
          const options = getTranslateOptions(getSettings());
          if (getCurrentUrl() !== currentUrl || isCleared(currentUrl)) {
            // changed while checking; leave it
          } else if (status === "active" || status === "error") {
            resumed = true;
            resumeJobChapter(currentUrl);
          } else if ((status === "abandoned" || status === "none") && canTranslateWith(options)) {
            // The job died, or never reached the server: start it again
            resumed = true;
            runChapter(currentUrl, produceChapter(currentUrl, options));
          }
        }
      }

      // Ask once more for the last translate-ahead window, in case its job chain
      // broke. Not while a chapter is being resumed (its job is still running),
      // and not if the user has started newer work since the app opened.
      const pendingWindow = getPendingWindow();
      if (!resumed && pendingWindow && !isCleared(pendingWindow) && getLastJobStartAt() < mountedAt) {
        const options = getTranslateOptions(getSettings());
        if (canTranslateWith(options)) {
          clearPendingWindow();
          startBackgroundJob(pendingWindow, options, getKnownChapters(pendingWindow), { remember: false }).catch(() => {});
        }
      }

      // After loading the chapter, which clears notices
      applySyncResult(result);
      checkForNewChapters(false);
    });

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        syncFinishedJobs().then(applySyncResult);
      }
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => document.removeEventListener("visibilitychange", handleVisible);
  }, []);

  // Save scroll position on scroll (debounced) and show/hide scroll-to-top button
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
      if (!url) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        saveScrollPosition(url, window.scrollY);
      }, 300);
    };
    // Save scroll immediately when user leaves/minimizes (reliable on mobile)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && url) {
        saveScrollPosition(url, window.scrollY);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [url]);

  useEffect(() => {
    document.documentElement.lang = settings.appLang;
  }, [settings.appLang]);

  useEffect(() => {
    setSystemAI(hasSystemAI());
    if (sessionPending) return;
    if (!sessionId) {
      rememberSystemAI(false);
      setSystemAI(false);
      return;
    }
    const controller = new AbortController();
    const refresh = () => refreshSystemAI(controller.signal).then(setSystemAI);
    // Again when the app is brought back: access may have been given or taken away
    const handleVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [sessionId, sessionPending]);

  // A signed-in user's settings come from their account, again whenever the
  // app is brought back (they may have been changed on another device)
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const sync = () => {
      syncSettings(sessionId, controller.signal)
        .then((synced) => synced && setSettings(synced))
        .catch(() => {});
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") sync();
      else flushSettings();
    };
    sync();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      controller.abort();
      flushSettings();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // The header slides away while reading down the chapter and returns on scrolling up
  useEffect(() => {
    let lastY = window.scrollY;
    const handleScroll = () => {
      const y = window.scrollY;
      if (y < 80) setHeaderHidden(false);
      else if (y > lastY + 8) setHeaderHidden(true);
      else if (y < lastY - 8) setHeaderHidden(false);
      else return; // ignore jitter, but let small moves add up
      lastY = y;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Another tab saved chapters or changed names: show them here too
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (!isGlossaryStorageKey(e.key)) return;
      refreshSaved();
      setGlossaryVersion((v) => v + 1);
      const shown = getCurrentUrl();
      if (shown) showGlossaryNames(extractNovelSlug(shown));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Offers to rename a name the user selects in the chapter
  useEffect(() => {
    const update = () => {
      const selection = document.getSelection();
      const container = textRef.current;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !container) return setSelectedName(null);
      if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return setSelectedName(null);
      // Without surrounding punctuation or spaces
      const text = selection.toString().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!text || text.length > 60 || /\n/.test(text)) return setSelectedName(null);
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const left = Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70);
      setSelectedName({ text, top: rect.bottom + 10, left });
    };
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update);
    };
  }, []);

  // The novels list shows new chapters: look for them when it is opened
  useEffect(() => {
    if (overlay === "library" && libraryTab === "novels") checkForNewChapters(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, libraryTab]);

  // The chapter the reader is on; opening it marks its novel's new chapters seen
  function markCurrent(chapterUrl: string) {
    setCurrentUrl(chapterUrl);
    setNovelUpdates(getNovelUpdates());
  }

  function toggleOverlay(next: Overlay) {
    setOverlay((prev) => (prev === next ? "none" : next));
  }

  // Asks the sites of the saved novels how many chapters they have now (those
  // checked recently are skipped unless `force`)
  async function checkForNewChapters(force: boolean) {
    if (checkingUpdatesRef.current) return;
    // A chapter of each novel, most recently saved novels first
    const novels = new Map<string, string>();
    for (const chapter of getSavedChapters()) {
      if (!novels.has(chapter.novelSlug)) novels.set(chapter.novelSlug, getLastReadUrl(chapter.novelSlug) ?? chapter.url);
    }
    if (novels.size === 0) return;
    checkingUpdatesRef.current = true;
    setCheckingUpdates(true);
    try {
      const grown = await checkNovelUpdates([...novels.values()].slice(0, MAX_CHECKED_NOVELS), { force });
      // The chapter being read may have been the latest: its Next button can light up now
      const shown = getCurrentUrl();
      const chapter = shown && grown.includes(extractNovelSlug(shown)) ? getSavedChapters().find((c) => c.url === shown) : null;
      if (chapter) refreshChapterLinks(chapter);
    } finally {
      checkingUpdatesRef.current = false;
      setCheckingUpdates(false);
      setNovelUpdates(getNovelUpdates());
    }
  }

  function openLibrary(tab?: LibraryTab) {
    // Opening a novel marked its new chapters as seen
    setNovelUpdates(getNovelUpdates());
    if (tab) {
      setLibraryTab(tab);
      setOverlay("library");
      return;
    }
    if (overlay !== "library") {
      setLibraryTab(openUrl || currentNovelChapters.length > 0 ? "chapters" : "novels");
      // The full list is fetched from the site only when asked for
      setChapterView("saved");
    }
    toggleOverlay("library");
  }

  function openSettings(tab?: SettingsTab) {
    if (tab) setSettingsTab(tab);
    setOverlay("settings");
  }

  const closeOverlay = () => setOverlay("none");

  function updateSettings(patch: Partial<ReaderSettings>) {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    saveSettings(updated);
    if (!sessionIdRef.current) return;
    // Typing a key or prompt is sent once it pauses
    clearTimeout(settingsPushRef.current);
    settingsPushRef.current = setTimeout(flushSettings, SETTINGS_PUSH_DELAY_MS);
  }

  // Sends a change still waiting to be sent to the account
  function flushSettings() {
    if (settingsPushRef.current === undefined) return;
    clearTimeout(settingsPushRef.current);
    settingsPushRef.current = undefined;
    if (sessionIdRef.current) pushSettings(getSettings(), getSettingsUpdatedAt()).catch(() => {});
  }

  function refreshSaved() {
    setSavedChapters(getSavedChapters());
  }

  function applySyncResult({ saved, evicted }: SyncResult) {
    if (saved) refreshSaved();
    if (evicted) setNotice({ kind: "evicted", count: evicted });
  }

  type ChapterProducer = (
    signal: AbortSignal,
    onMeta: (meta: ChapterMeta) => void,
    onText: (text: string) => void,
    // Whether the chapter is still the one on screen
    isShown: () => boolean
  ) => Promise<{ chapter: TranslatedChapter; fromJob: boolean }>;

  // Translates a chapter on the server so it keeps going (with the next
  // chapters) if the app is closed; in this tab when background jobs are unavailable
  function produceChapter(fetchUrl: string, options: TranslateOptions): ChapterProducer {
    return async (signal, onMeta, onText, isShown) => {
      const start = () =>
        startBackgroundJob(fetchUrl, options, getKnownChapters(fetchUrl, fetchUrl), { signal, force: true });
      // A dead worker is replaced only for the chapter on screen: a new job would
      // replace the one translating the chapter the reader moved on to
      const restart = () => (isShown() ? start() : Promise.resolve(null));
      // Before the request, so reopening the app finds this chapter even if it is closed right away
      if (backgroundJobsMaybeAvailable()) markCurrent(fetchUrl);
      const jobId = await start();
      if (jobId) {
        return { chapter: await watchJobChapter(fetchUrl, jobId, signal, onMeta, onText, restart), fromJob: true };
      }
      return { chapter: await translateChapterDirect(fetchUrl, options, signal, onMeta, onText), fromJob: false };
    };
  }

  // Shows a chapter while `produce` fetches/translates it, then saves it locally
  async function runChapter(
    fetchUrl: string,
    produce: ChapterProducer
  ): Promise<{ nextUrl: string | null } | null> {
    // The chapter on screen so far keeps translating off screen; the same
    // chapter translating off screen is started over here
    runsRef.current.get(fetchUrl)?.abort();
    lookupRef.current?.abort();
    // Opening a chapter means the user is reading this novel (again)
    reviveNovel(extractNovelSlug(fetchUrl));
    const controller = new AbortController();
    abortRef.current = controller;
    runsRef.current.set(fetchUrl, controller);
    const isShown = () => abortRef.current === controller && !controller.signal.aborted;

    setFetching(true);
    setNotice(null);
    setSimplifiedText("");
    setTitle("");
    setNovelName("");
    setChapterName("");
    setPrevUrl(null);
    setNextUrl(null);
    setUrl(fetchUrl);
    setOpenUrl(fetchUrl);
    window.scrollTo(0, 0);

    const onMeta = (meta: ChapterMeta) => {
      // Translating off screen, or a chunk already on its way when it was stopped
      if (!isShown()) return;
      setTitle(meta.title);
      setNovelName(meta.novelName);
      setChapterName(meta.chapterName);
      setPrevUrl(meta.prevUrl);
      setNextUrl(meta.nextUrl);
      setFetching(false);
      setSimplifying(true);
    };

    try {
      const { chapter, fromJob } = await produce(
        controller.signal,
        onMeta,
        (text) => {
          if (isShown()) setSimplifiedText(text);
        },
        isShown
      );
      const saved = await withStorageLock(() => {
        const slug = extractNovelSlug(fetchUrl);
        // The novel may have been deleted while this chapter was translating
        if (getClearedNovels().has(slug)) return null;
        // Finished off screen after the reader moved to another novel: with
        // auto-clear on, saving it would delete that novel's chapters (background
        // sync drops such chapters too)
        const reading = getCurrentUrl();
        if (!isShown() && getSettings().autoClearNovels && reading && extractNovelSlug(reading) !== slug) return null;
        return saveTranslatedChapter(fetchUrl, chapter);
      });
      if (fromJob) await acknowledgeJobChapters([fetchUrl]);
      // Deleted while translating, or stopped
      if (!saved || controller.signal.aborted) return null;
      const { text: savedText, title: savedTitle, evicted } = saved;
      refreshSaved();
      // Finished off screen: it is in the library now, the reader stays where they are
      if (!isShown()) return null;
      if (evicted) setNotice({ kind: "evicted", count: evicted });

      // With the names written the way the glossary does
      setSimplifiedText(savedText);
      setNovelName(chapter.novelName);
      setChapterName(savedTitle);
      setTitle(savedTitle);
      setPrevUrl(chapter.prevUrl);
      setNextUrl(chapter.nextUrl);
      markCurrent(fetchUrl);
      return { nextUrl: chapter.nextUrl };
    } catch (e: unknown) {
      // Off screen, a failure is silent: the chapter is translated again when opened
      if (!isShown()) return null;
      // Keep whatever was translated so far on screen; it is just not saved
      if (e instanceof StorageFullError) {
        setNotice({ kind: "storageFull" });
      } else if (e instanceof Error && e.name !== "AbortError") {
        setNotice({ kind: "error", message: e.message });
      }
      return null;
    } finally {
      if (runsRef.current.get(fetchUrl) === controller) runsRef.current.delete(fetchUrl);
      // Another chapter may have taken the screen; leave its loading state alone
      if (abortRef.current === controller) {
        setFetching(false);
        setSimplifying(false);
      }
    }
  }

  // The link the user typed, as a chapter URL: a missing https:// is added and
  // a novel's page becomes its first chapter. Null (error shown) if that fails.
  async function resolveEnteredUrl(entered: string): Promise<string | null> {
    const normalized = normalizeEnteredUrl(entered);
    if (!bookPageUrl(normalized)) return normalized;
    setFetching(true);
    setNotice(null);
    try {
      const chapterUrl = await fetchFirstChapterUrl(normalized);
      setUrl(chapterUrl);
      return chapterUrl;
    } catch (e: unknown) {
      setNotice({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      setFetching(false);
    }
  }

  const handleFetchAndSimplify = useCallback(
    async (targetUrl?: string): Promise<{ nextUrl: string | null } | null> => {
      // A typed link waits for the chapter on screen; a chapter picked to read does not
      if (!(targetUrl || url).trim() || (!targetUrl && (fetching || simplifying))) return null;
      // Links from navigation are chapter URLs already; a typed one may need resolving
      const fetchUrl = targetUrl || (await resolveEnteredUrl(url));
      if (!fetchUrl) return null;

      return runChapter(fetchUrl, produceChapter(fetchUrl, getTranslateOptions(settings)));
    },
    [url, fetching, simplifying, settings]
  );

  // Shows a chapter that a background job is still translating (restarting
  // the job if its worker died). Reads settings from storage: this also runs
  // from the mount effect, before the settings state is loaded.
  function resumeJobChapter(chapterUrl: string) {
    const options = getTranslateOptions(getSettings());
    const restart = () =>
      canTranslateWith(options)
        ? startBackgroundJob(chapterUrl, options, getKnownChapters(chapterUrl, chapterUrl), { force: true })
        : Promise.resolve(null);
    return runChapter(chapterUrl, async (signal, onMeta, onText, isShown) => ({
      chapter: await watchJobChapter(chapterUrl, null, signal, onMeta, onText, () => (isShown() ? restart() : Promise.resolve(null))),
      fromJob: true,
    }));
  }

  // Auto mode stops when the reader picks a chapter themselves; the chapter it
  // is translating goes on off screen
  function stopAutoMode() {
    autoSessionRef.current++;
    autoModeRef.current = false;
    setAutoTranslating(false);
  }

  function openChapterLink(targetUrl: string) {
    stopAutoMode();
    navigateToChapter(targetUrl);
  }

  function openSavedChapter(chapter: SavedChapter) {
    stopAutoMode();
    loadSavedChapter(chapter);
  }

  async function navigateToChapter(targetUrl: string) {
    window.scrollTo(0, 0);
    // Do not wait for the sync: if the app is closed right after Next, the job must already be on its way
    const sync = syncFinishedJobs();
    const saved = getSavedChapters().find((c) => c.url === targetUrl);
    let opening: Promise<unknown>;
    if (saved) {
      opening = loadSavedChapter(saved);
      // Keep the following chapters translating ahead in the background
      const options = getTranslateOptions(settings);
      if (canTranslateWith(options)) {
        startBackgroundJob(targetUrl, options, getKnownChapters(targetUrl)).catch(() => {});
      }
    } else {
      opening = handleFetchAndSimplify(targetUrl);
    }
    // Applied after the chapter started loading (which clears notices) so an eviction notice stays visible
    sync.then(applySyncResult);
    await opening;
  }

  async function loadSavedChapter(chapter: SavedChapter) {
    lookupRef.current?.abort();
    // A chapter being translated on screen goes on off screen (and is saved)
    abortRef.current = null;
    setFetching(false);
    setSimplifying(false);
    setNotice(null);
    setUrl(chapter.url);
    setOpenUrl(chapter.url);
    setTitle(chapter.title);
    setNovelName(chapter.novelName || "");
    setChapterName(chapter.title || "");
    setSimplifiedText(chapter.simplifiedText);
    setPrevUrl(chapter.prevUrl || null);
    setNextUrl(chapter.nextUrl || null);
    setOverlay("none");
    markCurrent(chapter.url);
    // Restore scroll position after content renders
    requestAnimationFrame(() => {
      const saved = getScrollPosition(chapter.url);
      window.scrollTo(0, saved);
    });
    await refreshChapterLinks(chapter);
  }

  // A saved chapter with no next chapter was the latest when it was saved: look
  // again, the site may have published the next one since
  async function refreshChapterLinks(chapter: SavedChapter) {
    if (chapter.nextUrl) return;
    try {
      const data = await fetchChapterContent(chapter.url);
      const prev = data.prevUrl ?? chapter.prevUrl;
      if (!data.nextUrl && prev === chapter.prevUrl) return;
      // Only if the chapter still exists (it may have been deleted meanwhile)
      const updated = await withStorageLock(() => updateChapterLinks(chapter.url, prev, data.nextUrl));
      if (!updated) return;
      refreshSaved();
      if (openUrlRef.current === chapter.url) {
        setPrevUrl(prev);
        setNextUrl(data.nextUrl);
      }
    } catch {
      // Offline or the site is down: the link stays as it was
    }
  }

  async function toggleAutoTranslate() {
    if (autoModeRef.current) {
      stopAutoMode();
      abortRef.current?.abort();
      // Also the chapters the server was translating ahead; the one it is on is finished and kept
      const shown = getCurrentUrl() || url;
      if (shown) acknowledgeJobChapters([], extractNovelSlug(shown));
      // …and not asked for again when the app is next opened
      clearPendingWindow();
      return;
    }
    if (!url.trim() || !canTranslateWith(getTranslateOptions(settings))) return;

    const session = ++autoSessionRef.current;
    const running = () => autoModeRef.current && autoSessionRef.current === session;
    autoModeRef.current = true;
    setAutoTranslating(true);
    setOverlay("none");

    let urlToProcess: string | null = await resolveEnteredUrl(url);
    const visited = new Set<string>();

    while (running() && urlToProcess && !visited.has(urlToProcess)) {
      visited.add(urlToProcess);
      const result = await handleFetchAndSimplify(urlToProcess);
      if (!running()) return;
      if (!result || !result.nextUrl) break;
      urlToProcess = result.nextUrl;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (autoSessionRef.current === session) stopAutoMode();
  }

  // A novel picked from the search results: where the reader left off when it
  // is saved already, else its first chapter
  async function openFoundNovel(novel: FoundNovel) {
    const slug = extractNovelSlug(novel.url);
    const saved = savedChapters.some((c) => c.novelSlug === slug);
    closeOverlay();
    if (!saved && !hasApiKey) return setNotice({ kind: "error", message: t.needApiKey });
    // The reader moves on to this novel: auto mode stops; the chapter being
    // translated goes on off screen
    stopAutoMode();
    lookupRef.current?.abort();
    if (saved) return handleSelectNovel(slug);

    const lookup = new AbortController();
    lookupRef.current = lookup;
    // The chapter on screen goes off screen; the lookup owns the loading state
    abortRef.current = null;
    setSimplifying(false);
    setFetching(true);
    setNotice(null);
    let chapterUrl: string;
    try {
      chapterUrl = await fetchFirstChapterUrl(novel.url, lookup.signal);
    } catch (e: unknown) {
      if (!lookup.signal.aborted) setNotice({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    } finally {
      // Not when another lookup took over, or a chapter opened meanwhile is loading (its own state)
      if (lookupRef.current === lookup) {
        lookupRef.current = null;
        if (abortRef.current === null) setFetching(false);
      }
    }
    // Another chapter was opened meanwhile
    if (lookup.signal.aborted) return;
    setUrl(chapterUrl);
    runChapter(chapterUrl, produceChapter(chapterUrl, getTranslateOptions(settings)));
  }

  // Opens a novel where the reader left off: the chapter last opened in it,
  // else (never opened on this device since) the most recently saved one
  function handleSelectNovel(slug: string) {
    const novelChapters = savedChapters.filter((c) => c.novelSlug === slug);
    const lastRead = getLastReadUrl(slug);
    const chapter =
      novelChapters.find((c) => c.url === lastRead) ?? novelChapters.reduce((a, b) => (a.savedAt > b.savedAt ? a : b));
    openSavedChapter(chapter);
  }

  async function handleClearNovel(novelSlug: string) {
    const name = savedChapters.find((c) => c.novelSlug === novelSlug && c.novelName)?.novelName || novelSlug;
    if (!window.confirm(t.confirmClearNovel.replace("{name}", name))) return;

    await withStorageLock(() => clearNovelChapters(novelSlug));
    discardNovelJobs(novelSlug);
    // It would write the deleted novel's names back
    if (currentNovelSlug === novelSlug) scanAbortRef.current?.abort();
    refreshSaved();
    // Chapters of it translating off screen would be saved back
    for (const [runUrl, run] of runsRef.current) if (extractNovelSlug(runUrl) === novelSlug) run.abort();
    if (url && extractNovelSlug(url) === novelSlug) {
      // Stop translating it (and auto mode), so it is not saved back
      stopAutoMode();
      abortRef.current?.abort();
      setSimplifiedText("");
      setTitle("");
      setNovelName("");
      setChapterName("");
      setUrl("");
      setOpenUrl("");
      setPrevUrl(null);
      setNextUrl(null);
    }
  }

  // After the glossary changed: the open chapter (unless still translating,
  // which is fixed when it is saved) shows the names as corrected
  function showGlossaryNames(novelSlug: string) {
    const shown = getCurrentUrl();
    if (loadingRef.current || !shown || extractNovelSlug(shown) !== novelSlug) return;
    const terms = getGlossary(novelSlug);
    setSimplifiedText((text) => applyNames(text, terms));
  }

  // Runs a change to the open novel's glossary, which also rewrites its saved chapters
  async function changeGlossary(change: (terms: GlossaryTerm[]) => GlossaryTerm[]) {
    if (!currentNovelSlug) return;
    try {
      await updateGlossary(currentNovelSlug, change);
    } catch (e: unknown) {
      if (e instanceof StorageFullError) setNotice({ kind: "storageFull" });
      else if (e instanceof Error) setNotice({ kind: "error", message: e.message });
    }
    showGlossaryNames(currentNovelSlug);
    refreshSaved();
    setGlossaryVersion((v) => v + 1);
  }

  function handleRename(from: string, to: string) {
    setRenameFrom(null);
    changeGlossary((terms) => renameTerm(terms, from, to));
  }

  function handleTermChange(term: GlossaryTerm, change: TermChange) {
    changeGlossary((terms) => editTerm(terms, termKey(term), term.target, change));
  }

  function handleTermDelete(term: GlossaryTerm) {
    changeGlossary((terms) => terms.filter((t) => termKey(t) !== termKey(term)));
  }

  async function handleScan() {
    if (!currentNovelSlug || scan) return;
    const novelSlug = currentNovelSlug;
    const controller = new AbortController();
    scanAbortRef.current = controller;
    setGlossaryMessage(null);
    setScan({ done: 0, total: 0 });
    try {
      const added = await scanSavedChapters(
        novelSlug,
        getTranslateOptions(settings),
        (done, total) => {
          setScan({ done, total });
          setGlossaryVersion((v) => v + 1);
        },
        controller.signal
      );
      setGlossaryMessage(t.scanDone.replace("{n}", String(added)));
    } finally {
      scanAbortRef.current = null;
      setScan(null);
      showGlossaryNames(novelSlug);
      refreshSaved();
      setGlossaryVersion((v) => v + 1);
    }
  }

  async function handleImport(file: File) {
    if (!currentNovelSlug) return;
    setGlossaryMessage(null);
    try {
      const count = await importGlossary(currentNovelSlug, file);
      setGlossaryMessage(count === null ? t.importFailed : t.importDone.replace("{n}", String(count)));
    } catch (e: unknown) {
      if (e instanceof StorageFullError) setNotice({ kind: "storageFull" });
    }
    showGlossaryNames(currentNovelSlug);
    refreshSaved();
    setGlossaryVersion((v) => v + 1);
  }

  const isLoading = fetching || simplifying;
  loadingRef.current = isLoading;
  const hasApiKey = systemAI || !!getApiKeyForModel(settings)?.trim();
  // Saved chapters open without an API key; new ones need one to be translated (or the app's)
  // Also while a chapter is translating: it goes on off screen
  const canNavigate = (target: string) => hasApiKey || savedChapters.some((c) => c.url === target);
  const buttonLabel = fetching
    ? t.fetching
    : simplifying
      ? t.simplifying
      : t.translate;
  const textColor = getTextColor(settings.bgColor);
  // Nothing opened yet (or the novel was deleted): the link form is the page
  const nothingOpen = !simplifiedText && !title && !novelName && !chapterName && !isLoading;
  const paragraphs = useMemo(() => simplifiedText.split("\n"), [simplifiedText]);

  const speechErrors: Record<SpeechError, string> = {
    unsupported: t.speechUnsupported,
    noVoice: t.noVietnameseVoice,
    needKey: t.speechNeedKey,
    badKey: t.speechBadKey,
    rateLimited: t.speechRateLimited,
    failed: t.speechFailed,
  };
  const speech = useSpeech({
    chapterKey: nothingOpen ? "" : openUrl,
    text: simplifiedText,
    loading: isLoading,
    engine: settings.speechEngine,
    deviceVoice: settings.speechVoice,
    aiVoice: settings.speechAiVoice,
    rate: settings.speechRate,
    openaiApiKey: settings.openaiApiKey,
    title: chapterName || title,
    novelName,
    firstVisibleParagraph,
    onChapterEnd: () => {
      if (!nextUrl || !canNavigate(nextUrl)) return false;
      navigateToChapter(nextUrl);
      return true;
    },
    onError: (error) => setNotice({ kind: "error", message: speechErrors[error] }),
  });
  const reading = speech.status !== "off";

  // The paragraph at the top of the screen, where reading aloud starts
  function firstVisibleParagraph(): number {
    const lines = Array.from(textRef.current?.querySelectorAll<HTMLElement>("[data-p]") ?? []);
    const top = lines.find((line) => line.getBoundingClientRect().bottom > 64);
    return top ? Number(top.dataset.p) : 0;
  }

  // Keeps the paragraph being read on screen
  useEffect(() => {
    if (speech.paragraph === null || document.visibilityState !== "visible") return;
    const line = textRef.current?.querySelector<HTMLElement>(`[data-p="${speech.paragraph}"]`);
    if (!line) return;
    const rect = line.getBoundingClientRect();
    if (rect.top < 64 || rect.top > window.innerHeight - 160) {
      window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: "smooth" });
    }
  }, [speech.paragraph]);

  // Saved chapters per novel, to mark the search results already being read
  const libraryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chapter of savedChapters) counts.set(chapter.novelSlug, (counts.get(chapter.novelSlug) ?? 0) + 1);
    return counts;
  }, [savedChapters]);

  // A saved novel's site has chapters the reader has not seen yet
  const hasNewChapters = Object.entries(novelUpdates).some(([slug, update]) => update.total > update.seen && libraryCounts.has(slug));

  // Finding a novel by name, or opening it from a link
  const startPanel = (autoFocus: boolean) => (
    <div className="flex flex-col gap-4">
      <NovelSearch
        t={t}
        textColor={textColor}
        apiKey={settings.openaiApiKey}
        library={libraryCounts}
        autoFocus={autoFocus}
        onOpen={openFoundNovel}
      />
      <div className="flex items-center gap-3 text-xs" style={{ color: textColor + "80" }}>
        <span className="flex-1 border-t" style={{ borderColor: textColor + "20" }} />
        {t.orPasteLink}
        <span className="flex-1 border-t" style={{ borderColor: textColor + "20" }} />
      </div>
      {linkForm()}
    </div>
  );

  const linkForm = () => (
    <LinkForm
      t={t}
      textColor={textColor}
      url={url}
      onUrlChange={setUrl}
      onTranslate={() => {
        closeOverlay();
        handleFetchAndSimplify();
      }}
      onAutoTranslate={toggleAutoTranslate}
      autoTranslating={autoTranslating}
      isLoading={isLoading}
      buttonLabel={buttonLabel}
      hasApiKey={hasApiKey}
      onAddApiKey={() => openSettings("ai")}
    />
  );

  const noticeBanner = notice && (
    <div
      role={notice.kind === "error" ? "alert" : "status"}
      className="flex items-start gap-3 mb-2 px-3 py-2 rounded-lg border text-sm"
      style={
        notice.kind === "error"
          ? { borderColor: "#dc262680", backgroundColor: "#dc262614" }
          : { borderColor: textColor + "30", backgroundColor: textColor + "0d" }
      }
    >
      <span className="flex-1 whitespace-pre-wrap">
        {notice.kind === "error"
          ? notice.message
          : notice.kind === "storageFull"
            ? t.storageFull
            : t.storageEvicted.replace("{n}", String(notice.count))}
      </span>
      <button
        onClick={() => setNotice(null)}
        className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
        aria-label={t.dismiss}
      >
        ✕
      </button>
    </div>
  );

  return (
    <main
      className="min-h-screen transition-colors duration-200"
      style={{ backgroundColor: settings.bgColor, color: textColor }}
    >
      <header
        className={
          "sticky top-0 z-40 border-b transition-transform duration-200" +
          (headerHidden && overlay === "none" ? " -translate-y-full" : "")
        }
        style={{ backgroundColor: settings.bgColor, borderColor: textColor + "15" }}
      >
        <div className="relative max-w-4xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-1 sm:gap-2">
          <HeaderButton
            label={t.library}
            icon={<ListIcon />}
            onClick={() => openLibrary()}
            active={overlay === "library"}
            textColor={textColor}
            showLabel
            dot={hasNewChapters ? t.hasNewChapters : undefined}
          />
          <p className="flex-1 min-w-0 truncate text-center text-sm sm:text-base font-semibold px-1">
            {novelName || t.appTitle}
          </p>
          <HeaderButton
            label={t.newNovel}
            icon={<PlusIcon />}
            onClick={() => toggleOverlay("new")}
            active={overlay === "new"}
            textColor={textColor}
            showLabel
          />
          {!nothingOpen && (
            <HeaderButton
              label={reading ? t.stopReading : t.readAloud}
              icon={<HeadphonesIcon />}
              onClick={() => (reading ? speech.stop() : speech.start())}
              active={reading}
              textColor={textColor}
            />
          )}
          <HeaderButton
            label={t.display}
            icon={<TypeIcon />}
            onClick={() => toggleOverlay("display")}
            active={overlay === "display"}
            textColor={textColor}
          />
          <HeaderButton
            label={t.settings}
            icon={<SettingsIcon />}
            onClick={() => (overlay === "settings" ? closeOverlay() : openSettings())}
            active={overlay === "settings"}
            textColor={textColor}
          />

          {overlay === "new" && (
            <Popover label={t.newNovel} textColor={textColor} bgColor={settings.bgColor} onClose={closeOverlay}>
              {startPanel(true)}
            </Popover>
          )}
          {overlay === "display" && (
            <Popover label={t.display} textColor={textColor} bgColor={settings.bgColor} onClose={closeOverlay}>
              <DisplaySettings settings={settings} textColor={textColor} t={t} onUpdate={updateSettings} />
            </Popover>
          )}
        </div>
      </header>

      <div className={"max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6" + (reading ? " pb-32" : "")}>
        {nothingOpen ? (
          <section className="max-w-xl mx-auto py-6 sm:py-12">
            <h1 className="text-xl sm:text-2xl font-semibold text-center mb-6">{t.emptyTitle}</h1>
            {noticeBanner}
            {startPanel(false)}
          </section>
        ) : (
          <>
            {(novelName || chapterName || title) && (
              <div className="text-center mb-4">
                {novelName && <h1 className="text-lg font-semibold">{novelName}</h1>}
                {chapterName && (
                  <p className="text-sm mt-1" style={{ color: textColor + "80" }}>{chapterName}</p>
                )}
                {!novelName && !chapterName && title && <h1 className="text-lg font-semibold">{title}</h1>}
                {settings.autoGlossary && !isLoading && chapterNewTerms.length > 0 && (
                  <button
                    onClick={() => openLibrary("names")}
                    className="mt-2 max-w-full truncate text-xs cursor-pointer hover:underline"
                    style={{ color: textColor + "80" }}
                  >
                    ✓{" "}
                    {t.newNames
                      .replace("{n}", String(chapterNewTerms.length))
                      .replace("{list}", chapterNewTerms.slice(0, 4).map((term) => term.target).join(", ") + (chapterNewTerms.length > 4 ? "…" : ""))}
                  </button>
                )}
              </div>
            )}

            {noticeBanner}

            <NavButtons prevUrl={prevUrl} nextUrl={nextUrl} canNavigate={canNavigate} textColor={textColor} prevLabel={t.previous} nextLabel={t.next} onNavigate={openChapterLink} />

            <div
              ref={textRef}
              className="min-h-[60vh] px-1 sm:px-2 py-4 whitespace-pre-wrap"
              style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineSpacing }}
              onClick={(e) => {
                // While reading aloud, a tapped paragraph is read from its start
                if (!reading || !document.getSelection()?.isCollapsed) return;
                const line = (e.target as HTMLElement).closest<HTMLElement>("[data-p]");
                if (line) speech.seekParagraph(Number(line.dataset.p));
              }}
            >
              {simplifiedText ? (
                paragraphs.map((line, i) => (
                  <Fragment key={i}>
                    <span
                      data-p={i}
                      className={speech.paragraph === i ? "rounded-sm" : undefined}
                      style={speech.paragraph === i ? { backgroundColor: "#3b82f630", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" } : undefined}
                    >
                      {line}
                    </span>
                    {i < paragraphs.length - 1 && "\n"}
                  </Fragment>
                ))
              ) : (
                <span className={isLoading ? "animate-pulse" : undefined} style={{ color: textColor + "60" }}>
                  {isLoading ? buttonLabel : t.contentPlaceholder}
                </span>
              )}
            </div>

            <NavButtons prevUrl={prevUrl} nextUrl={nextUrl} canNavigate={canNavigate} textColor={textColor} prevLabel={t.previous} nextLabel={t.next} onNavigate={openChapterLink} />
          </>
        )}
      </div>

      {autoTranslating && (
        <button
          onClick={toggleAutoTranslate}
          className={"fixed left-6 h-12 px-4 rounded-full shadow-lg flex items-center gap-2 cursor-pointer z-30 text-sm font-medium transition-all hover:scale-105" + (reading ? " bottom-32" : " bottom-6")}
          style={{ backgroundColor: "#dc2626", color: "#ffffff" }}
          aria-label={t.pause}
        >
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          {t.autoRunning} • {t.pause}
        </button>
      )}

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className={"fixed right-6 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 cursor-pointer z-30" + (reading ? " bottom-32" : " bottom-6")}
          style={{
            backgroundColor: textColor + "20",
            color: textColor,
            border: `1px solid ${textColor}30`,
            backdropFilter: "blur(8px)",
          }}
          aria-label="Scroll to top"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </button>
      )}
      {reading && (
        <SpeechPlayer
          status={speech.status}
          position={speech.position}
          total={speech.total}
          rate={settings.speechRate}
          sleep={speech.sleep}
          sleepLeft={speech.sleepLeft}
          textColor={textColor}
          bgColor={settings.bgColor}
          t={t}
          onToggle={speech.toggle}
          onSkip={speech.skip}
          onStop={speech.stop}
          onRate={(speechRate) => updateSettings({ speechRate })}
          onSleep={speech.setSleep}
          onSettings={() => openSettings("speech")}
        />
      )}
      {settings.autoGlossary && selectedName && !isLoading && overlay === "none" && !renameFrom && currentNovelSlug && (
        <button
          // Keeps the selection while pressing
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            setRenameFrom(selectedName.text);
            document.getSelection()?.removeAllRanges();
          }}
          className="fixed z-30 -translate-x-1/2 px-3 py-1.5 rounded-full shadow-lg text-sm font-medium cursor-pointer text-white bg-blue-600 hover:bg-blue-700"
          style={{ top: selectedName.top, left: selectedName.left }}
        >
          ✎ {t.renameName}
        </button>
      )}

      {renameFrom && (
        <RenameDialog
          from={renameFrom}
          source={glossary.find((term) => term.target === renameFrom)?.source}
          t={t}
          textColor={textColor}
          bgColor={settings.bgColor}
          onRename={(to) => handleRename(renameFrom, to)}
          onClose={() => setRenameFrom(null)}
        />
      )}

      {overlay === "library" && (
        <Sheet
          side="left"
          title={t.library}
          closeLabel={t.close}
          textColor={textColor}
          bgColor={settings.bgColor}
          onClose={closeOverlay}
          header={
            <Tabs
              idPrefix="library"
              tabs={[
                { id: "chapters", label: t.chapters },
                { id: "names", label: `${t.names} (${glossary.length})` },
                { id: "novels", label: t.novels },
              ]}
              active={libraryTab}
              onChange={setLibraryTab}
              textColor={textColor}
            />
          }
        >
          <TabPanel idPrefix="library" active={libraryTab}>
            {libraryTab === "chapters" ? (
              <>
                {libraryUrl && (
                  <div className="flex gap-1 mb-3 p-1 rounded-lg" style={{ backgroundColor: textColor + "0d" }}>
                    {(["saved", "toc"] as const).map((view) => (
                      <button
                        key={view}
                        onClick={() => setChapterView(view)}
                        aria-pressed={chapterView === view}
                        className="flex-1 px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors"
                        style={chapterView === view ? { backgroundColor: settings.bgColor, color: "#3b82f6" } : { color: textColor + "99" }}
                      >
                        {view === "toc" ? t.allChapters : `${t.savedChapters} (${currentNovelChapters.length})`}
                      </button>
                    ))}
                  </div>
                )}
                {libraryUrl && chapterView === "toc" ? (
                  <ChapterDirectory
                    novelUrl={libraryUrl}
                    chapters={currentNovelChapters}
                    currentUrl={openUrl || null}
                    openaiApiKey={settings.openaiApiKey}
                    canNavigate={canNavigate}
                    textColor={textColor}
                    bgColor={settings.bgColor}
                    t={t}
                    onOpen={(target) => {
                      closeOverlay();
                      openChapterLink(target);
                    }}
                  />
                ) : (
                  <>
                    {currentNovelChapters.length >= MAX_CHAPTERS_PER_NOVEL && (
                      <p className="mb-2 text-xs" style={{ color: textColor + "80" }}>
                        {t.chapterCapNote.replace("{n}", String(MAX_CHAPTERS_PER_NOVEL))}
                      </p>
                    )}
                    <SavedChaptersList
                      chapters={currentNovelChapters}
                      settings={settings}
                      textColor={textColor}
                      currentUrl={libraryUrl}
                      t={t}
                      onLoad={openSavedChapter}
                    />
                  </>
                )}
              </>
            ) : libraryTab === "names" ? (
              <GlossaryPanel
                terms={glossary}
                textColor={textColor}
                bgColor={settings.bgColor}
                t={t}
                novelSlug={nothingOpen ? null : currentNovelSlug}
                enabled={settings.autoGlossary}
                onToggle={(autoGlossary) => updateSettings({ autoGlossary })}
                canScan={hasApiKey && currentNovelChapters.length > 0}
                scanChapters={Math.min(SCAN_CHAPTERS, currentNovelChapters.length)}
                scan={scan}
                message={glossaryMessage}
                onChange={handleTermChange}
                onDelete={handleTermDelete}
                onClearAll={() => changeGlossary(() => [])}
                onScan={handleScan}
                onStopScan={() => scanAbortRef.current?.abort()}
                onExport={() => currentNovelSlug && exportGlossary(currentNovelSlug, novelName)}
                onImport={handleImport}
              />
            ) : (
              <SavedNovelsList
                chapters={savedChapters}
                updates={novelUpdates}
                checking={checkingUpdates}
                onCheck={() => checkForNewChapters(true)}
                textColor={textColor}
                currentNovelSlug={currentNovelSlug}
                t={t}
                onSelectNovel={handleSelectNovel}
                onClearNovel={handleClearNovel}
              />
            )}
          </TabPanel>
        </Sheet>
      )}

      {overlay === "settings" && (
        <Sheet
          side="right"
          title={t.settings}
          closeLabel={t.close}
          textColor={textColor}
          bgColor={settings.bgColor}
          onClose={closeOverlay}
          header={
            <Tabs
              idPrefix="settings"
              tabs={[
                { id: "ai", label: t.aiSettings },
                { id: "speech", label: t.readAloud },
                { id: "general", label: t.general },
                { id: "account", label: t.account },
                { id: "contact", label: t.contact },
              ]}
              active={settingsTab}
              onChange={setSettingsTab}
              textColor={textColor}
            />
          }
        >
          <TabPanel idPrefix="settings" active={settingsTab}>
            {settingsTab === "ai" && <AISettingsPanel settings={settings} systemAI={systemAI} textColor={textColor} t={t} onUpdate={updateSettings} />}
            {settingsTab === "speech" && <SpeechSettings settings={settings} textColor={textColor} t={t} onUpdate={updateSettings} />}
            {settingsTab === "general" && <GeneralSettings settings={settings} textColor={textColor} t={t} onUpdate={updateSettings} />}
            {settingsTab === "account" && <AccountPanel textColor={textColor} t={t} />}
            {settingsTab === "contact" && <ContactPanel textColor={textColor} />}
          </TabPanel>
        </Sheet>
      )}
    </main>
  );
}
