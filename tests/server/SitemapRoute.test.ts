import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ServerEnv } from "../../src/server/ServerEnv";
import {
  registerSitemapRoutes,
  robotsTxt,
  SitemapEntryCache,
  sitemapXml,
} from "../../src/server/SitemapRoute";
import type { SitemapEntries } from "../../src/server/stats/seoQueries";

const ENTRIES: SitemapEntries = {
  profiles: [
    { publicId: "abc123", lastmod: new Date("2026-10-20T10:00:00.000Z") },
  ],
  games: [{ gameId: "AbCdEfGh", lastmod: new Date("2026-10-21T12:30:00Z") }],
};

describe("SitemapRoute", () => {
  test("lists absolute URLs on the public origin", () => {
    const xml = sitemapXml("https://kleopolis.io");
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset /);
    expect(xml).toContain("<loc>https://kleopolis.io/</loc>");
    expect(xml).toContain("<loc>https://kleopolis.io/leaderboard</loc>");
    expect(xml).toContain(
      "<loc>https://kleopolis.io/privacy-policy.html</loc>",
    );
    expect(xml).not.toMatch(/<loc>\//);
  });

  test("adds profiles and games with lastmod", () => {
    const xml = sitemapXml("https://kleopolis.io", ENTRIES);
    expect(xml).toContain(
      "<url><loc>https://kleopolis.io/player/abc123</loc><lastmod>2026-10-20T10:00:00.000Z</lastmod></url>",
    );
    const worker = ServerEnv.workerPath("AbCdEfGh");
    expect(xml).toContain(
      `<url><loc>https://kleopolis.io/${worker}/game/AbCdEfGh</loc><lastmod>2026-10-21T12:30:00.000Z</lastmod></url>`,
    );
  });

  test("encodes the ids it lists", () => {
    const xml = sitemapXml("https://kleopolis.io", {
      profiles: [{ publicId: "a&b<c>", lastmod: new Date(0) }],
      games: [],
    });
    expect(xml).toContain(
      "<loc>https://kleopolis.io/player/a%26b%3Cc%3E</loc>",
    );
    expect(xml).not.toContain("a&b");
  });

  test("robots.txt points at the sitemap and keeps crawlers off the API", () => {
    const robots = robotsTxt("https://kleopolis.io");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Sitemap: https://kleopolis.io/sitemap.xml");
  });
});

describe("SitemapEntryCache", () => {
  test("reads once per hour and shares a read in flight", async () => {
    let now = 0;
    const load = vi.fn(async () => ENTRIES);
    const cache = new SitemapEntryCache(load, undefined, () => now);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(ENTRIES);
    expect(b).toBe(ENTRIES);
    expect(load).toHaveBeenCalledTimes(1);
    now = 59 * 60 * 1000;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
    now = 61 * 60 * 1000;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("a failed read gives null, then the last good entries, and retries", async () => {
    let now = 0;
    const log = { warn: vi.fn() };
    const load = vi.fn(async (): Promise<SitemapEntries> => {
      throw new Error("db down");
    });
    const cache = new SitemapEntryCache(load, log, () => now);
    expect(await cache.get()).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    // No new read until the retry delay passes.
    now = 30 * 1000;
    expect(await cache.get()).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);

    now = 2 * 60 * 1000;
    load.mockResolvedValueOnce(ENTRIES);
    expect(await cache.get()).toBe(ENTRIES);

    now += 2 * 60 * 60 * 1000;
    expect(await cache.get()).toBe(ENTRIES);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe("sitemap route", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  async function serve(loadEntries: () => Promise<SitemapEntries>) {
    const app = express();
    const log = { warn: vi.fn() };
    registerSitemapRoutes(app, { log, loadEntries });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, log };
  }

  test("serves only the static pages when the database is down", async () => {
    const { base, log } = await serve(async () => {
      throw new Error("connection refused");
    });
    const res = await fetch(`${base}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("/leaderboard</loc>");
    expect(xml).not.toContain("/player/");
    expect(xml).not.toContain("/game/");
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    expect(log.warn).toHaveBeenCalled();
  });

  test("serves the database entries when it answers", async () => {
    const { base } = await serve(async () => ENTRIES);
    const xml = await (await fetch(`${base}/sitemap.xml`)).text();
    expect(xml).toContain("/player/abc123</loc>");
    expect(xml).toContain("/game/AbCdEfGh</loc>");
  });
});
