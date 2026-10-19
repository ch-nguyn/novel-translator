import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
  async headers() {
    return [
      // A new version of the app reaches installed copies on their next visit
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
