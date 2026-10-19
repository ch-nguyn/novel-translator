import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Novel Translator",
  description: "Translate and simplify novels for easy reading",
  appleWebApp: { capable: true, title: "Dịch truyện", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The page's background; changed with the reader's (app/page.tsx)
  themeColor: "#f5f5dc",
};

// Before the app loads: the browser's offer to install it can come right
// away, and is kept for the Install button (app/components/InstallApp.tsx).
// The service worker (public/sw.js) is only used by the built app.
const setupScript = `
window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); window.__installPrompt = e; });
window.addEventListener("appinstalled", function () { window.__installPrompt = null; });
${
  process.env.NODE_ENV === "production"
    ? `if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });`
    : ""
}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <head>
        <script dangerouslySetInnerHTML={{ __html: setupScript }} />
      </head>
      <body className="bg-gray-50 text-gray-900 min-h-screen">{children}</body>
    </html>
  );
}
