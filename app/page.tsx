"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { DEFAULT_AI_MODEL, SavedChapter, ReaderSettings, getTextColor, getApiKeyForModel, isChatGPTModel } from "./lib/types";
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
  deduplicateTitle,
} from "./lib/storage";
import { fetchChapterContent, simplifyText, translateTitles } from "./lib/api";
import SettingsPanel from "./components/SettingsPanel";
import AISettingsPanel from "./components/AISettingsPanel";
import SavedChaptersList from "./components/SavedChaptersList";
import SavedNovelsList from "./components/SavedNovelsList";
import NavButtons from "./components/NavButtons";
import ContactPanel from "./components/ContactPanel";
import { getTranslations } from "./lib/i18n";

type Panel = "none" | "chapters" | "novels" | "settings" | "ai-settings" | "contact";

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

  const handleFetchAndSimplify = useCallback(
    async (targetUrl?: string): Promise<{ nextUrl: string | null } | null> => {
      const fetchUrl = targetUrl || url;
      if (!fetchUrl.trim() || fetching || simplifying) return null;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setFetching(true);
      setSimplifiedText("");
      setTitle("");
      setNovelName("");
      setChapterName("");
      setPrevUrl(null);
      setNextUrl(null);
      if (targetUrl) setUrl(targetUrl);
      window.scrollTo(0, 0);

      let resultNextUrl: string | null = null;
      let success = false;

      try {
        const data = await fetchChapterContent(fetchUrl, controller.signal);
        let chapterTitle = data.title;

        setTitle(chapterTitle);
        setNovelName(data.novelName);
        setChapterName(data.chapterName);
        setPrevUrl(data.prevUrl);
        setNextUrl(data.nextUrl);
        resultNextUrl = data.nextUrl;
        setFetching(false);
        setSimplifying(true);

        const result = await simplifyText(
          data.text,
          getApiKeyForModel(settings),
          settings.aiModel,
          data.lang,
          controller.signal,
          setSimplifiedText,
          settings.customPrompt,
          settings.referenceLinks,
          settings.reasoningEffort,
          isChatGPTModel(settings.aiModel) ? settings.webSearch : false
        );

        // Translate title if Chinese (single API call for both titles)
        if (data.lang === "zh" && data.chapterName) {
          try {
            const translated = await translateTitles(
              [data.chapterName, data.novelName],
              getApiKeyForModel(settings),
              settings.aiModel,
              "Dịch tiêu đề truyện sau từ tiếng Trung sang tiếng Việt (ưu tiên Hán Việt) phổ thông dễ hiểu. KHÔNG được để lại bất kỳ chữ Trung Quốc nào. Giữ nguyên dấu '-' phân cách giữa tên truyện và tên chương. Chỉ trả về bản dịch, không giải thích."
            );
            const cName = translated[0] || data.chapterName;
            const nName = translated[1] || data.novelName;
            setChapterName(cName);
            setNovelName(nName);
            setTitle(cName);
            data.chapterName = cName;
            data.novelName = nName;
          } catch { /* keep original */ }
        }

        const chapterSlug = extractNovelSlug(fetchUrl);
        const dedupedTitle = deduplicateTitle(
          data.chapterName || chapterTitle || fetchUrl,
          chapterSlug
        );
        setChapterName(dedupedTitle);
        setTitle(dedupedTitle);

        saveChapter({
          url: fetchUrl,
          title: dedupedTitle,
          novelName: data.novelName || "",
          novelSlug: chapterSlug,
          simplifiedText: result,
          prevUrl: data.prevUrl,
          nextUrl: data.nextUrl,
          savedAt: Date.now(),
        });
        refreshSaved();
        setCurrentUrl(fetchUrl);
        success = true;
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") {
          setSimplifiedText(`Error: ${e.message}`);
        }
      } finally {
        setFetching(false);
        setSimplifying(false);
      }

      return success ? { nextUrl: resultNextUrl } : null;
    },
    [url, fetching, simplifying, getApiKeyForModel(settings), settings.aiModel]
  );

  async function navigateToChapter(targetUrl: string) {
    window.scrollTo(0, 0);
    const saved = getSavedChapters().find((c) => c.url === targetUrl);
    if (saved) {
      await loadSavedChapter(saved);
    } else {
      await handleFetchAndSimplify(targetUrl);
    }
  }

  async function loadSavedChapter(chapter: SavedChapter) {
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
        setPrevUrl(data.prevUrl);
        setNextUrl(data.nextUrl);
        saveChapter({ ...chapter, prevUrl: data.prevUrl, nextUrl: data.nextUrl });
        refreshSaved();
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

  function handleClearNovel(novelSlug: string) {
    clearNovelChapters(novelSlug);
    refreshSaved();
    if (url && extractNovelSlug(url) === novelSlug) {
      setSimplifiedText("");
      setTitle("");
      setUrl("");
      setPrevUrl(null);
      setNextUrl(null);
    }
  }

  const isLoading = fetching || simplifying;
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

          <NavButtons prevUrl={prevUrl} nextUrl={nextUrl} disabled={isLoading || !getApiKeyForModel(settings)?.trim()} textColor={textColor} prevLabel={t.previous} nextLabel={t.next} onNavigate={navigateToChapter} />

          <div
            className="min-h-[60vh] px-1 sm:px-2 py-4 whitespace-pre-wrap"
            style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineSpacing }}
          >
            {simplifiedText || (
              <span style={{ color: textColor + "40" }}>{t.contentPlaceholder}</span>
            )}
          </div>

          <NavButtons prevUrl={prevUrl} nextUrl={nextUrl} disabled={isLoading || !getApiKeyForModel(settings)?.trim()} textColor={textColor} prevLabel={t.previous} nextLabel={t.next} onNavigate={navigateToChapter} />
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
