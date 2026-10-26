import type { Express } from "express";
import { publicOrigin } from "./auth/config";

// The pages a search engine should index. Each one serves real content at
// that URL: the app shell routes and the static policy and press pages.
const SITEMAP_PATHS = [
  "/",
  "/leaderboard",
  "/press/",
  "/privacy-policy.html",
  "/terms-of-service.html",
];

const CACHE_CONTROL = "public, max-age=3600";

export function sitemapXml(origin: string): string {
  const urls = SITEMAP_PATHS.map(
    (p) => `  <url><loc>${new URL(p, origin).href}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${new URL("/sitemap.xml", origin).href}`,
    "",
  ].join("\n");
}

// Both files name absolute URLs, so they are built from PUBLIC_ORIGIN and not
// shipped as static files. Register before the static handler and the SPA
// fallback, which would otherwise answer with the app shell.
export function registerSitemapRoutes(app: Express): void {
  app.get("/sitemap.xml", (_req, res) => {
    res.setHeader("Cache-Control", CACHE_CONTROL);
    res.type("application/xml").send(sitemapXml(publicOrigin()));
  });
  app.get("/robots.txt", (_req, res) => {
    res.setHeader("Cache-Control", CACHE_CONTROL);
    res.type("text/plain").send(robotsTxt(publicOrigin()));
  });
}
