import type { MetadataRoute } from "next";

// Where the app is served (VERCEL_PROJECT_PRODUCTION_URL on Vercel)
const origin =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

// Lets the app be installed on a phone's home screen or a computer (see public/sw.js)
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Novel Translator",
    short_name: "Dịch truyện",
    description: "Đọc truyện tiếng Trung bằng tiếng Việt",
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5dc",
    theme_color: "#f5f5dc",
    // The app itself, so Chrome on Android can tell the page it is installed
    // (app/components/InstallApp.tsx)
    ...(origin && { related_applications: [{ platform: "webapp", url: `${origin.replace(/\/+$/, "")}/manifest.webmanifest` }] }),
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
