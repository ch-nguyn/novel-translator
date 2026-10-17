"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { DEFAULT_AI_MODEL, SavedChapter, ReaderSettings, TranslatedChapter, TranslateOptions, getTextColor, getApiKeyForModel, getTranslateOptions } from "./lib/types";
import {
  getSavedChapters,
  saveChapter,
  clearNovelChapters,
  extractNovelSlug,
  getCurrentUrl,
  setCurrentUrl,
  getSettings,
  saveSettings,
  getScrollPosition,
  saveScrollPosition,
  getKnownChapters,
  getClearedNovels,
  reviveNovel,
  withStorageLock,
  StorageFullError,
  getPendingWindow,
  clearPendingWindow,
} from "./lib/storage";
import { ChapterMeta, fetchChapterContent, translateChapterDirect } from "./lib/api";
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
import SettingsPanel from "./components/SettingsPanel";
import AISettingsPanel from "./components/AISettingsPanel";
import SavedChaptersList from "./components/SavedChaptersList";
import SavedNovelsList from "./components/SavedNovelsList";
import NavButtons from "./components/NavButtons";
import ContactPanel from "./components/ContactPanel";
import { getTranslations } from "./lib/i18n";

type Panel = "none" | "chapters" | "novels" | "settings" | "ai-settings" | "contact";

// Message shown above the chapter text
type Notice =
  | { kind: "error"; message: string }
  // Old chapters were removed because browser storage was full
  | { kind: "evicted"; count: number }
  // A chapter could not be saved even after removing old ones
  | { kind: "storageFull" };

export default function Home() {
  const [url, setUrl] = useState("");
  const [simplifiedText, setSimplifiedText] = useState("");
  const [fetching, setFetching] = useState(false);
  const [simplifying, setSimplifying] = useState(false);
  const [title, setTitle] = useState("");
  const [novelName, setNovelName] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [savedChapters, setSavedChapters] = useState<SavedChapter[]>([]);
  const [activePanel, setActivePanel] = useState<Panel>("none");
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
    referenceLinks: "",
    reasoningEffort: "medium",
    webSearch: false,
  });
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [autoTranslating, setAutoTranslating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoModeRef = useRef(false);
  const t = getTranslations(settings.appLang);

  const currentNovelSlug = url ? extractNovelSlug(url) : null;

  const currentNovelChapters = currentNovelSlug
    ? savedChapters.filter((c) => c.novelSlug === currentNovelSlug)
    : [];

  useEffect(() => {
    setSavedChapters(getSavedChapters());
    setSettings(getSettings());

    const currentUrl = getCurrentUrl();
    const shownAtStart = !!currentUrl && getSavedChapters().some((c) => c.url === currentUrl);
    if (currentUrl) {
      const chapter = getSavedChapters().find((c) => c.url === currentUrl);
      if (chapter) {
        setUrl(chapter.url);
        setTitle(chapter.title);
        setSimplifiedText(chapter.simplifiedText);
        setPrevUrl(chapter.prevUrl || null);
        setNextUrl(chapter.nextUrl || null);
        // Restore scroll position after content renders
        // Use setTimeout to wait for React to render the content
        setTimeout(() => {
          const saved = getScrollPosition(currentUrl);
          if (saved) window.scrollTo(0, saved);
        }, 100);
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
          } else if ((status === "abandoned" || status === "none") && options.apiKey.trim()) {
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
        if (options.apiKey.trim()) {
          clearPendingWindow();
          startBackgroundJob(pendingWindow, options, getKnownChapters(pendingWindow), { remember: false }).catch(() => {});
        }
      }

      // After loading the chapter, which clears notices
      applySyncResult(result);
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

  function togglePanel(panel: Panel) {
    setActivePanel((prev) => (prev === panel ? "none" : panel));
  }

  function updateSettings(patch: Partial<ReaderSettings>) {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    saveSettings(updated);
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
    onText: (text: string) => void
  ) => Promise<{ chapter: TranslatedChapter; fromJob: boolean }>;

  // Translates a chapter on the server so it keeps going (with the next
  // chapters) if the app is closed; in this tab when background jobs are unavailable
  function produceChapter(fetchUrl: string, options: TranslateOptions): ChapterProducer {
    return async (signal, onMeta, onText) => {
      const start = () =>
        startBackgroundJob(fetchUrl, options, getKnownChapters(fetchUrl, fetchUrl), { signal, force: true });
      // Before the request, so reopening the app finds this chapter even if it is closed right away
      if (backgroundJobsMaybeAvailable()) setCurrentUrl(fetchUrl);
      const jobId = await start();
      if (jobId) {
        return { chapter: await watchJobChapter(fetchUrl, jobId, signal, onMeta, onText, start), fromJob: true };
      }
      return { chapter: await translateChapterDirect(fetchUrl, options, signal, onMeta, onText), fromJob: false };
    };
  }

  // Shows a chapter while `produce` fetches/translates it, then saves it locally
  async function runChapter(
    fetchUrl: string,
    produce: ChapterProducer
  ): Promise<{ nextUrl: string | null } | null> {
    abortRef.current?.abort();
    // Opening a chapter means the user is reading this novel (again)
    reviveNovel(extractNovelSlug(fetchUrl));
    const controller = new AbortController();
    abortRef.current = controller;

    setFetching(true);
    setNotice(null);
    setSimplifiedText("");
    setTitle("");
    setNovelName("");
    setChapterName("");
    setPrevUrl(null);
    setNextUrl(null);
    setUrl(fetchUrl);
    window.scrollTo(0, 0);

    const onMeta = (meta: ChapterMeta) => {
      setTitle(meta.title);
      setNovelName(meta.novelName);
      setChapterName(meta.chapterName);
      setPrevUrl(meta.prevUrl);
      setNextUrl(meta.nextUrl);
      setFetching(false);
      setSimplifying(true);
    };

    try {
      const { chapter, fromJob } = await produce(controller.signal, onMeta, setSimplifiedText);
      const saved = await withStorageLock(() =>
        // The novel may have been deleted while this chapter was translating
        getClearedNovels().has(extractNovelSlug(fetchUrl)) ? null : saveTranslatedChapter(fetchUrl, chapter)
      );
      if (fromJob) await acknowledgeJobChapters([fetchUrl]);
      // Deleted while translating, or the user opened another chapter meanwhile
      if (!saved || controller.signal.aborted) return null;
      const { title: savedTitle, evicted } = saved;
      if (evicted) setNotice({ kind: "evicted", count: evicted });

      setSimplifiedText(chapter.text);
      setNovelName(chapter.novelName);
      setChapterName(savedTitle);
      setTitle(savedTitle);
      setPrevUrl(chapter.prevUrl);
      setNextUrl(chapter.nextUrl);
      refreshSaved();
      setCurrentUrl(fetchUrl);
      return { nextUrl: chapter.nextUrl };
    } catch (e: unknown) {
      // Keep whatever was translated so far on screen; it is just not saved
      if (e instanceof StorageFullError) {
        setNotice({ kind: "storageFull" });
      } else if (e instanceof Error && e.name !== "AbortError") {
        setNotice({ kind: "error", message: e.message });
      }
      return null;
    } finally {
      // A newer chapter may have taken over (and aborted this one); leave its loading state alone
      if (abortRef.current === controller) {
        setFetching(false);
        setSimplifying(false);
      }
    }
  }

  const handleFetchAndSimplify = useCallback(
    async (targetUrl?: string): Promise<{ nextUrl: string | null } | null> => {
      const fetchUrl = targetUrl || url;
      if (!fetchUrl.trim() || fetching || simplifying) return null;

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
      options.apiKey.trim()
        ? startBackgroundJob(chapterUrl, options, getKnownChapters(chapterUrl, chapterUrl), { force: true })
        : Promise.resolve(null);
    return runChapter(chapterUrl, async (signal, onMeta, onText) => ({
      chapter: await watchJobChapter(chapterUrl, null, signal, onMeta, onText, restart),
      fromJob: true,
    }));
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
      if (options.apiKey.trim()) {
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
    setNotice(null);
    setUrl(chapter.url);
    setTitle(chapter.title);
    setNovelName(chapter.novelName || "");
    setChapterName(chapter.title || "");
    setSimplifiedText(chapter.simplifiedText);
    setPrevUrl(chapter.prevUrl || null);
    setNextUrl(chapter.nextUrl || null);
    setActivePanel("none");
    setCurrentUrl(chapter.url);
    // Restore scroll position after content renders
    requestAnimationFrame(() => {
      const saved = getScrollPosition(chapter.url);
      window.scrollTo(0, saved);
    });

    if (!chapter.prevUrl && !chapter.nextUrl) {
      try {
        const data = await fetchChapterContent(chapter.url);
        // Only if the chapter still exists (it may have been deleted meanwhile)
        const updated = await withStorageLock(() => {
          const current = getSavedChapters().find((c) => c.url === chapter.url);
          if (!current) return false;
          saveChapter({ ...current, prevUrl: data.prevUrl, nextUrl: data.nextUrl });
          return true;
        });
        if (!updated) return;
        refreshSaved();
        if (getCurrentUrl() === chapter.url) {
          setPrevUrl(data.prevUrl);
          setNextUrl(data.nextUrl);
        }
      } catch {
        // Ignore
      }
    }
  }

  async function toggleAutoTranslate() {
    if (autoModeRef.current) {
      autoModeRef.current = false;
      setAutoTranslating(false);
      abortRef.current?.abort();
      return;
    }
    if (!url.trim() || !getApiKeyForModel(settings)?.trim()) return;

    autoModeRef.current = true;
    setAutoTranslating(true);
    setActivePanel("none");

    let urlToProcess: string | null = url;
    const visited = new Set<string>();

    while (autoModeRef.current && urlToProcess && !visited.has(urlToProcess)) {
      visited.add(urlToProcess);
      const result = await handleFetchAndSimplify(urlToProcess);
      if (!autoModeRef.current) break;
      if (!result || !result.nextUrl) break;
      urlToProcess = result.nextUrl;
      await new Promise((r) => setTimeout(r, 500));
    }

    autoModeRef.current = false;
    setAutoTranslating(false);
  }

  function handleSelectNovel(slug: string) {
    const novelChapters = savedChapters.filter((c) => c.novelSlug === slug);
    const latest = novelChapters.reduce((a, b) => (a.savedAt > b.savedAt ? a : b));
    loadSavedChapter(latest);
  }

  async function handleClearNovel(novelSlug: string) {
    const name = savedChapters.find((c) => c.novelSlug === novelSlug && c.novelName)?.novelName || novelSlug;
    if (!window.confirm(t.confirmClearNovel.replace("{name}", name))) return;

    await withStorageLock(() => clearNovelChapters(novelSlug));
    discardNovelJobs(novelSlug);
    refreshSaved();
    if (url && extractNovelSlug(url) === novelSlug) {
      // Stop translating it (and auto mode), so it is not saved back
      autoModeRef.current = false;
      setAutoTranslating(false);
      abortRef.current?.abort();
      setSimplifiedText("");
      setTitle("");
      setUrl("");
      setPrevUrl(null);
      setNextUrl(null);
    }
  }

  const isLoading = fetching || simplifying;
  const hasApiKey = !!getApiKeyForModel(settings)?.trim();
  // Saved chapters open without an API key; new ones need one to be translated
  const canNavigate = (target: string) =>
    !isLoading && (hasApiKey || savedChapters.some((c) => c.url === target));
  const buttonLabel = fetching
    ? t.fetching
    : simplifying
      ? t.simplifying
      : t.translate;
  const textColor = getTextColor(settings.bgColor);
  const [menuOpen, setMenuOpen] = useState(false);
  const btnStyle = { borderColor: textColor + "30", color: textColor, backgroundColor: settings.bgColor };
  const btnClass = "panel-btn px-3 py-1.5 rounded-lg text-sm font-medium border transition-all cursor-pointer";

  function handleMenuAction(panel: Panel) {
    togglePanel(panel);
    setMenuOpen(false);
  }

  return (
    <main
      className="min-h-screen transition-colors duration-200"
      style={{ backgroundColor: settings.bgColor, color: textColor }}
    >
      <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h1 className="text-lg sm:text-xl font-bold">{t.appTitle}</h1>

          {/* Desktop buttons */}
          <div className="hidden sm:flex gap-2">
            <button
              onClick={() => togglePanel("chapters")}
              disabled={!currentNovelSlug || currentNovelChapters.length === 0}
              className={btnClass + " text-sm disabled:opacity-30 disabled:cursor-not-allowed" + (activePanel === "chapters" ? " active" : "")}
              style={btnStyle}
            >
              {t.chapters} ({currentNovelChapters.length})
            </button>
            <button
              onClick={() => togglePanel("novels")}
              className={btnClass + " text-sm" + (activePanel === "novels" ? " active" : "")}
              style={btnStyle}
            >
              {t.novels}
            </button>
            <button
              onClick={() => togglePanel("ai-settings")}
              className={btnClass + " text-sm" + (activePanel === "ai-settings" ? " active" : "")}
              style={btnStyle}
            >
              {t.aiSettings}
            </button>
            <button
              onClick={() => togglePanel("settings")}
              className={btnClass + " text-sm" + (activePanel === "settings" ? " active" : "")}
              style={btnStyle}
            >
              {t.settings}
            </button>
            <button
              onClick={() => togglePanel("contact")}
              className={btnClass + " text-sm" + (activePanel === "contact" ? " active" : "")}
              style={btnStyle}
            >
              {t.contact}
            </button>
          </div>

          {/* Mobile hamburger menu */}
          <div className="relative sm:hidden">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={btnClass + (menuOpen ? " active" : "")}
              style={btnStyle}
              aria-label={t.menu}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {menuOpen ? (
                  <>
                    <path d="M18 6L6 18" />
                    <path d="M6 6l12 12" />
                  </>
                ) : (
                  <>
                    <path d="M3 12h18" />
                    <path d="M3 6h18" />
                    <path d="M3 18h18" />
                  </>
                )}
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute right-0 top-full mt-2 z-50 rounded-lg border shadow-lg min-w-48 py-1 flex flex-col"
                  style={{ borderColor: textColor + "20", backgroundColor: settings.bgColor }}
                >
                  <button
                    onClick={() => handleMenuAction("chapters")}
                    disabled={!currentNovelSlug || currentNovelChapters.length === 0}
                    className={"px-4 py-2.5 text-sm text-left transition-all disabled:opacity-30 disabled:cursor-not-allowed" + (activePanel === "chapters" ? " font-bold" : "")}
                    style={{ color: textColor, backgroundColor: activePanel === "chapters" ? textColor + "10" : "transparent" }}
                  >
                    {t.chapters} ({currentNovelChapters.length})
                  </button>
                  <button
                    onClick={() => handleMenuAction("novels")}
                    className={"px-4 py-2.5 text-sm text-left transition-all" + (activePanel === "novels" ? " font-bold" : "")}
                    style={{ color: textColor, backgroundColor: activePanel === "novels" ? textColor + "10" : "transparent" }}
                  >
                    {t.novels}
                  </button>
                  <button
                    onClick={() => handleMenuAction("ai-settings")}
                    className={"px-4 py-2.5 text-sm text-left transition-all" + (activePanel === "ai-settings" ? " font-bold" : "")}
                    style={{ color: textColor, backgroundColor: activePanel === "ai-settings" ? textColor + "10" : "transparent" }}
                  >
                    {t.aiSettings}
                  </button>
                  <button
                    onClick={() => handleMenuAction("settings")}
                    className={"px-4 py-2.5 text-sm text-left transition-all" + (activePanel === "settings" ? " font-bold" : "")}
                    style={{ color: textColor, backgroundColor: activePanel === "settings" ? textColor + "10" : "transparent" }}
                  >
                    {t.settings}
                  </button>
                  <button
                    onClick={() => handleMenuAction("contact")}
                    className={"px-4 py-2.5 text-sm text-left transition-all" + (activePanel === "contact" ? " font-bold" : "")}
                    style={{ color: textColor, backgroundColor: activePanel === "contact" ? textColor + "10" : "transparent" }}
                  >
                    {t.contact}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {activePanel !== "none" && (
          <div
            className="fixed inset-0 z-10"
            onClick={() => setActivePanel("none")}
          />
        )}

        {activePanel === "ai-settings" && (
          <div className="relative z-20">
            <AISettingsPanel
              settings={settings}
              textColor={textColor}
              t={t}
              onUpdate={updateSettings}
            />
          </div>
        )}

        {activePanel === "settings" && (
          <div className="relative z-20">
            <SettingsPanel
              settings={settings}
              textColor={textColor}
              t={t}
              url={url}
              onUrlChange={setUrl}
              onTranslate={() => {
                setActivePanel("none");
                handleFetchAndSimplify();
              }}
              onAutoTranslate={toggleAutoTranslate}
              autoTranslating={autoTranslating}
              isLoading={isLoading}
              buttonLabel={buttonLabel}
              onUpdate={updateSettings}
            />
          </div>
        )}

        {activePanel === "novels" && (
          <div className="relative z-20">
            <SavedNovelsList
              chapters={savedChapters}
              settings={settings}
              textColor={textColor}
              currentNovelSlug={currentNovelSlug}
              t={t}
              onSelectNovel={handleSelectNovel}
              onClearNovel={handleClearNovel}
            />
          </div>
        )}

        {activePanel === "chapters" && (
          <div className="relative z-20">
            <SavedChaptersList
              chapters={currentNovelChapters}
              settings={settings}
              textColor={textColor}
              currentUrl={url}
              t={t}
              onLoad={loadSavedChapter}
            />
          </div>
        )}

        {activePanel === "contact" && (
          <div className="relative z-20">
            <ContactPanel textColor={textColor} />
          </div>
        )}

        <div>
          {(novelName || chapterName || title) && (
            <div className="text-center mb-4">
              {novelName && (
                <h2 className="text-lg font-semibold">{novelName}</h2>
              )}
              {chapterName && (
                <p className="text-sm mt-1" style={{ color: textColor + "80" }}>{chapterName}</p>
              )}
              {!novelName && !chapterName && title && (
                <h2 className="text-lg font-semibold">{title}</h2>
              )}
            </div>
          )}

          {notice && (
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
          )}

          <NavButtons prevUrl={prevUrl} nextUrl={nextUrl} canNavigate={canNavigate} textColor={textColor} prevLabel={t.previous} nextLabel={t.next} onNavigate={navigateToChapter} />

          <div
            className="min-h-[60vh] px-1 sm:px-2 py-4 whitespace-pre-wrap"
            style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineSpacing }}
          >
            {simplifiedText || (
              <span style={{ color: textColor + "40" }}>{t.contentPlaceholder}</span>
            )}
          </div>

          <NavButtons prevUrl={prevUrl} nextUrl={nextUrl} canNavigate={canNavigate} textColor={textColor} prevLabel={t.previous} nextLabel={t.next} onNavigate={navigateToChapter} />
        </div>
      </div>

      {autoTranslating && (
        <button
          onClick={toggleAutoTranslate}
          className="fixed bottom-6 left-6 h-12 px-4 rounded-full shadow-lg flex items-center gap-2 cursor-pointer z-50 text-sm font-medium transition-all hover:scale-105"
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
          className="fixed bottom-6 right-6 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 cursor-pointer z-50"
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
    </main>
  );
}
