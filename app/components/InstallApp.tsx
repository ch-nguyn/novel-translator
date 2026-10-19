"use client";

import { useEffect, useState } from "react";
import { Translations } from "../lib/i18n";

// The browser's offer to install the app (Chrome, Edge), kept by app/layout.tsx
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __installPrompt?: InstallPrompt | null;
  }
  interface Navigator {
    // Chrome: the installed apps the manifest lists in related_applications
    getInstalledRelatedApps?: () => Promise<unknown[]>;
  }
}

// Set when the app was installed from this browser (app/layout.tsx) or has
// been opened installed. Chrome on some phones still offers to install it afterwards.
const INSTALLED_KEY = "novel-translator-installed";

// "open": running as the installed app; "installed": in the browser, with
// the app installed
type Install = "open" | "installed" | "prompt" | "ios" | "none";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

async function currentInstall(): Promise<Install> {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) {
    // The installed app shares storage with the browser (Chrome): its pages there know too
    localStorage.setItem(INSTALLED_KEY, "1");
    return "open";
  }
  const related = await navigator.getInstalledRelatedApps?.().catch(() => []);
  if ((related && related.length > 0) || localStorage.getItem(INSTALLED_KEY)) return "installed";
  if (window.__installPrompt) return "prompt";
  // Safari on iPhone/iPad has no prompt: the user adds it from the Share menu
  return isIos() ? "ios" : "none";
}

// Installing the app on the home screen (see app/manifest.ts); nothing where
// the browser cannot
export default function InstallApp({ textColor, t }: { textColor: string; t: Translations }) {
  const [install, setInstall] = useState<Install>("none");
  // The browser still offers to install it (e.g. it was uninstalled)
  const [canPrompt, setCanPrompt] = useState(false);
  const android = typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);

  useEffect(() => {
    let active = true;
    const update = () => {
      setCanPrompt(!!window.__installPrompt);
      currentInstall().then((next) => active && setInstall(next));
    };
    update();
    // After app/layout.tsx's listeners, which keep the offer
    const later = () => setTimeout(update);
    window.addEventListener("beforeinstallprompt", later);
    window.addEventListener("appinstalled", later);
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", later);
      window.removeEventListener("appinstalled", later);
    };
  }, []);

  async function installNow() {
    const prompt = window.__installPrompt;
    if (!prompt) return;
    await prompt.prompt().catch(() => {});
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    // An offer is used once; the browser makes another if it was turned down
    window.__installPrompt = null;
    setCanPrompt(false);
    if (outcome === "accepted") localStorage.setItem(INSTALLED_KEY, "1");
    setInstall(await currentInstall());
  }

  if (install === "none" || install === "open") return null;
  const muted = { color: textColor + "80" };
  const androidHint = android && <p className="text-xs mt-1" style={muted}>{t.installAndroidHint}</p>;
  if (install === "installed") {
    return (
      <div>
        <p className="text-xs" style={muted}>
          {t.installed}
          {canPrompt && (
            <>
              {" "}
              <button onClick={installNow} className="underline cursor-pointer hover:opacity-70">
                {t.reinstallApp}
              </button>
            </>
          )}
        </p>
        {androidHint}
      </div>
    );
  }
  return (
    <div>
      {install === "prompt" ? (
        <button
          onClick={installNow}
          className="w-full px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer text-white bg-blue-600 hover:bg-blue-700"
        >
          {t.installApp}
        </button>
      ) : (
        <p className="text-sm font-medium">{t.installApp}</p>
      )}
      <p className="text-xs mt-1" style={muted}>
        {t.installAppNote}
        {install === "ios" && " " + t.installIos}
      </p>
      {androidHint}
    </div>
  );
}
