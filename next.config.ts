import type { NextConfig } from "next";

// Every page and answer: never shown inside another site's frame (a page
// dressed up around the app), files are only what their type says, and other
// sites are told only the app's address. No script policy: Next's own inline
// scripts would need a nonce, which renders every page per request.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // A new version of the app reaches installed copies on their next visit
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
