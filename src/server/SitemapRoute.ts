import type { Express } from "express";
import type { Logger } from "winston";
import { publicOrigin } from "./auth/config";
import { db } from "./db";
import { escapeHtml } from "./GamePreviewBuilder";
import { gamePageUrl, playerPageUrl } from "./SeoMeta";
import { SEO_PAGE_PATHS } from "./SeoPages";
import { type SitemapEntries, sitemapEntries } from "./stats/seoQueries";

// The pages a search engine should index. Each one serves real content at
// that URL: the app shell routes, the static policy and press pages, and the
// landing pages (SeoPages).
const SITEMAP_PATHS = [
  "/",
  "/leaderboard",
  "/press/",
  "/privacy-policy.html",
  "/terms-of-service.html",
];

const CACHE_CONTROL = "public, max-age=3600";

// How long one database read serves the sitemap, and how soon a failed read
// is tried again.
const ENTRIES_TTL_MS = 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
// A database that does not answer must not hold the request open.
const QUERY_TIMEOUT_MS = 5000;

function urlTag(loc: string, lastmod?: Date): string {
  const mod = lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : "";
  return `  <url><loc>${escapeHtml(loc)}</loc>${mod}</url>`;
}

export function sitemapXml(origin: string, entries?: SitemapEntries): string {
  const urls = [...SITEMAP_PATHS, ...SEO_PAGE_PATHS].map((p) =>
    urlTag(new URL(p, origin).href),
  );
  for (const p of entries?.profiles ?? []) {
    urls.push(urlTag(playerPageUrl(origin, p.publicId), p.lastmod));
  }
  for (const g of entries?.games ?? []) {
    urls.push(urlTag(gamePageUrl(origin, g.gameId), g.lastmod));
  }
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms} ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Reads the sitemap's dynamic entries at most once per TTL. Concurrent
 * requests share one read. When the read fails it resolves to null (the
 * caller serves the static pages) and tries again after a short delay.
 */
export class SitemapEntryCache {
  private value: SitemapEntries | null = null;
  private expiresAt = 0;
  private inFlight: Promise<SitemapEntries | null> | null = null;

  constructor(
    private readonly load: () => Promise<SitemapEntries>,
    private readonly log?: Pick<Logger, "warn">,
    private readonly now: () => number = Date.now,
  ) {}

  get(): Promise<SitemapEntries | null> {
    if (this.now() < this.expiresAt) return Promise.resolve(this.value);
    this.inFlight ??= withTimeout(this.load(), QUERY_TIMEOUT_MS)
      .then((entries) => {
        this.value = entries;
        this.expiresAt = this.now() + ENTRIES_TTL_MS;
        return entries;
      })
      .catch((error: unknown) => {
        this.log?.warn("sitemap: database read failed, static pages only", {
          error,
        });
        // Keep serving the last good entries, if any, until the retry.
        this.expiresAt = this.now() + RETRY_AFTER_FAILURE_MS;
        return this.value;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}

// Both files name absolute URLs, so they are built from PUBLIC_ORIGIN and not
// shipped as static files. Register before the static handler and the SPA
// fallback, which would otherwise answer with the app shell.
export function registerSitemapRoutes(
  app: Express,
  opts: {
    log?: Pick<Logger, "warn">;
    // For tests. Defaults to the database.
    loadEntries?: () => Promise<SitemapEntries>;
  } = {},
): void {
  const cache = new SitemapEntryCache(
    opts.loadEntries ?? (() => sitemapEntries(db().db)),
    opts.log,
  );
  app.get("/sitemap.xml", async (_req, res) => {
    const origin = publicOrigin();
    let xml: string;
    try {
      xml = sitemapXml(origin, (await cache.get()) ?? undefined);
    } catch (error) {
      opts.log?.warn("sitemap: dynamic entries failed, static pages only", {
        error,
      });
      xml = sitemapXml(origin);
    }
    res.setHeader("Cache-Control", CACHE_CONTROL);
    res.type("application/xml").send(xml);
  });
  app.get("/robots.txt", (_req, res) => {
    res.setHeader("Cache-Control", CACHE_CONTROL);
    res.type("text/plain").send(robotsTxt(publicOrigin()));
  });
}
