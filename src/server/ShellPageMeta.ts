import type { Response } from "express";
import { publicOrigin } from "./auth/config";
import { getAppShellContent, setAppShellCacheHeaders } from "./RenderHtml";
import { type HeadMeta, injectHeadMeta } from "./SeoMeta";

const DESCRIPTION =
  "Kleopolis is a free real-time strategy game in your browser. Expand your territory, build alliances, and conquer the map in solo, open lobby, and ranked matches.";

// Head tags for the app shell routes a search engine indexes (see
// SitemapRoute). Null for any other path.
export function shellPageMeta(
  pathname: string,
  origin: string,
): HeadMeta | null {
  const url = new URL(pathname, origin).href;
  switch (pathname) {
    case "/":
      return {
        title: "Kleopolis - Real-Time Territory Strategy Game",
        description: DESCRIPTION,
        canonical: url,
        ogType: "website",
        twitterCard: "summary_large_image",
        jsonLd: {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebSite", name: "Kleopolis", url },
            {
              "@type": "VideoGame",
              name: "Kleopolis",
              url,
              description: DESCRIPTION,
              genre: "Real-time strategy",
              gamePlatform: "Web browser",
              applicationCategory: "GameApplication",
              operatingSystem: "Any",
              playMode: ["SinglePlayer", "MultiPlayer"],
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            },
          ],
        },
      };
    case "/leaderboard":
      return {
        title: "Leaderboard - Kleopolis",
        description:
          "The top-rated Kleopolis players on each ranked ladder, with Elo ratings and win records.",
        canonical: url,
        ogType: "website",
        twitterCard: "summary_large_image",
      };
    default:
      return null;
  }
}

// One rendered page per path, rebuilt when the shell changes.
const rendered = new Map<string, { shell: string; page: string }>();

/**
 * Serve the app shell with the head tags of `pathname`. Returns false, and
 * sends nothing, when the path has no tags of its own.
 */
export async function sendShellPage(
  res: Response,
  htmlPath: string,
  pathname: string,
): Promise<boolean> {
  const meta = shellPageMeta(pathname, publicOrigin());
  if (meta === null) return false;
  const shell = await getAppShellContent(htmlPath);
  let entry = rendered.get(pathname);
  if (entry?.shell !== shell) {
    entry = { shell, page: injectHeadMeta(shell, meta) };
    rendered.set(pathname, entry);
  }
  setAppShellCacheHeaders(res);
  res.send(entry.page);
  return true;
}
