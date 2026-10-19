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
}

type Install = "installed" | "prompt" | "ios" | "none";

function currentInstall(): Install {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  if (window.__installPrompt) return "prompt";
  // Safari on iPhone/iPad has no prompt: the user adds it from the Share menu
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "none";
}

// Installing the app on the home screen (see app/manifest.ts); nothing where
// the browser cannot
export default function InstallApp({ textColor, t }: { textColor: string; t: Translations }) {
  const [install, setInstall] = useState<Install>("none");

  useEffect(() => {
    const update = () => setInstall(currentInstall());
    update();
    // After app/layout.tsx's listeners, which keep the offer
    const later = () => setTimeout(update);
    window.addEventListener("beforeinstallprompt", later);
    window.addEventListener("appinstalled", later);
    return () => {
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
    setInstall(outcome === "accepted" ? "installed" : currentInstall());
  }

  if (install === "none") return null;
  const muted = { color: textColor + "80" };
  if (install === "installed") return <p className="text-xs" style={muted}>{t.installed}</p>;
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
    </div>
  );
}
