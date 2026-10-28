import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  gamesLikeOpenfrontPage,
  mapPage,
  type MapFacts,
  mapSlug,
  openfrontAlternativePage,
  type PageContext,
  readMapFacts,
  registerSeoPages,
  SEO_MAPS,
  SEO_PAGE_PATHS,
} from "../../src/server/SeoPages";
import { sitemapXml } from "../../src/server/SitemapRoute";

const CTX: PageContext = {
  origin: "https://kleopolis.io",
  assetUrl: (path) => `https://cdn.example.com/${path}`,
};

// The parser writes void tags as `<link ... >`.
function canonical(url: string): RegExp {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<link rel="canonical" href="${escaped}"\\s*/?>`);
}

const WORLD = SEO_MAPS.find((m) => m.type === GameMapType.World)!;

const FACTS: MapFacts = {
  landTiles: 2_000_000,
  nations: ["Atlantis", "Lemuria <b>"],
};

describe("SEO maps", () => {
  test("every map has a unique, URL-safe slug", () => {
    const slugs = SEO_MAPS.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("slugs come from the display name", () => {
    expect(mapSlug("Bab el-Mandeb Strait")).toBe("bab-el-mandeb-strait");
    expect(SEO_MAPS.find((m) => m.type === GameMapType.AmazonRiver)?.slug).toBe(
      "amazon-river",
    );
  });

  test("leaves out tournament maps and keeps the prime-time maps", () => {
    expect(SEO_MAPS.some((m) => m.categories.includes("tournament"))).toBe(
      false,
    );
    expect(WORLD.primeTime).toBe(true);
  });

  test("reads the nations from a real manifest", async () => {
    const facts = await readMapFacts(GameMapType.Africa);
    expect(facts.landTiles).toBeGreaterThan(0);
    expect(facts.nations).toContain("South Africa");
  });
});

describe("SEO page content", () => {
  test("the alternative page credits OpenFront and never ranks it", () => {
    const html = openfrontAlternativePage(CTX);
    expect(html).toMatch(
      canonical("https://kleopolis.io/openfront-alternative"),
    );
    expect(html).toContain('href="https://openfront.io"');
    expect(html).toContain("AGPL-3.0");
    expect(html).toContain('"@type":"FAQPage"');
    expect(html.toLowerCase()).not.toContain("better than");
    expect(html).toContain('href="/games-like-openfront"');
    expect(html).toContain('href="/"');
  });

  test("the games-like page links the prime-time maps", () => {
    const html = gamesLikeOpenfrontPage(CTX);
    expect(html).toMatch(
      canonical("https://kleopolis.io/games-like-openfront"),
    );
    expect(html).toContain('href="/maps/world"');
    expect(html).toContain('href="/openfront-alternative"');
  });

  test("a map page names players, nations and its thumbnail", () => {
    const html = mapPage(CTX, WORLD, FACTS);
    expect(html).toContain("<title>World map - Kleopolis</title>");
    expect(html).toMatch(canonical("https://kleopolis.io/maps/world"));
    expect(html).toMatch(
      /<meta property="og:image" content="https:\/\/cdn\.example\.com\/maps\/world\/thumbnail\.webp"\s*\/?>/,
    );
    expect(html).toContain("Players: up to 100");
    expect(html).toContain("Atlantis, Lemuria &lt;b&gt;");
    expect(html).not.toContain("Lemuria <b>");
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  test("a map page without its manifest leaves out the player count", () => {
    const html = mapPage(CTX, WORLD, null);
    expect(html).not.toContain("Players:");
    expect(html).not.toContain("Nations on");
    expect(html).toContain("<h1>World</h1>");
  });

  test("the sitemap lists every landing page", () => {
    const xml = sitemapXml("https://kleopolis.io");
    for (const path of SEO_PAGE_PATHS) {
      expect(xml).toContain(`<loc>https://kleopolis.io${path}</loc>`);
    }
    expect(xml).toContain("<loc>https://kleopolis.io/maps/world</loc>");
    expect(xml).toContain(
      "<loc>https://kleopolis.io/openfront-alternative</loc>",
    );
  });
});

describe("SEO page routes", () => {
  let server: Server | undefined;
  const loadMapFacts = vi.fn<(map: GameMapType) => Promise<MapFacts>>();
  const log = { warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://kleopolis.io");
    loadMapFacts.mockReset();
    loadMapFacts.mockResolvedValue(FACTS);
    log.warn.mockReset();
    log.error.mockReset();
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    vi.unstubAllEnvs();
  });

  async function serve(): Promise<string> {
    const app = express();
    registerSeoPages(app, { log, loadMapFacts });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  test("serves each landing page as cacheable HTML", async () => {
    const base = await serve();
    for (const path of [
      "/openfront-alternative",
      "/games-like-openfront",
      "/maps",
      "/maps/world",
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(await res.text()).toMatch(
        canonical(`https://kleopolis.io${path}`),
      );
    }
  });

  test("an unknown map is a 404 that is not indexed", async () => {
    const base = await serve();
    const res = await fetch(`${base}/maps/nowhere`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toMatch(/<meta name="robots" content="noindex"\s*\/?>/);
    expect(html).not.toContain('rel="canonical"');
  });

  test("renders a map page once and keeps it", async () => {
    const base = await serve();
    await fetch(`${base}/maps/world`);
    await fetch(`${base}/maps/world`);
    expect(loadMapFacts).toHaveBeenCalledTimes(1);
    expect(loadMapFacts).toHaveBeenCalledWith(GameMapType.World);
  });

  test("a failed manifest read serves the page and tries again later", async () => {
    loadMapFacts.mockRejectedValueOnce(new Error("missing"));
    const base = await serve();
    const first = await fetch(`${base}/maps/world`);
    expect(first.status).toBe(200);
    expect(await first.text()).not.toContain("Players:");
    expect(log.warn).toHaveBeenCalledTimes(1);

    const second = await (await fetch(`${base}/maps/world`)).text();
    expect(second).toContain("Players: up to 100");
    expect(loadMapFacts).toHaveBeenCalledTimes(2);
  });
});
