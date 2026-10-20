import type { MetadataRoute } from "next";
import { siteOrigin } from "./lib/siteUrl";

// Search engines index the app's pages, not its API
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    ...(siteOrigin && { sitemap: `${siteOrigin}/sitemap.xml` }),
  };
}
