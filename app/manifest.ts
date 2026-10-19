import type { MetadataRoute } from "next";

// Lets the app be installed on a phone's home screen or a computer (see public/sw.js)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Novel Translator",
    short_name: "Dịch truyện",
    description: "Đọc truyện tiếng Trung bằng tiếng Việt",
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5dc",
    theme_color: "#f5f5dc",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
