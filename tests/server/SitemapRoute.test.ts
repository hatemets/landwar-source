import { describe, expect, test } from "vitest";
import { robotsTxt, sitemapXml } from "../../src/server/SitemapRoute";

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

  test("robots.txt points at the sitemap and keeps crawlers off the API", () => {
    const robots = robotsTxt("https://kleopolis.io");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Sitemap: https://kleopolis.io/sitemap.xml");
  });
});
