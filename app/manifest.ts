import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE, siteOrigin as origin } from "./lib/siteUrl";

// Lets the app be installed on a phone's home screen or a computer (see public/sw.js)
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: "Dịch truyện",
    description: APP_TAGLINE,
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5dc",
    theme_color: "#f5f5dc",
    // The app itself, so Chrome on Android can tell the page it is installed
    // (app/components/InstallApp.tsx)
    ...(origin && { related_applications: [{ platform: "webapp", url: `${origin}/manifest.webmanifest` }] }),
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
