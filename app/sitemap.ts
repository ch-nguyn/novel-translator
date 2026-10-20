import type { MetadataRoute } from "next";
import { siteOrigin } from "./lib/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/terms", "/privacy"].map((path) => ({ url: `${siteOrigin}${path}` }));
}
