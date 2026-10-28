import {
  type GameMapName,
  GameMapType,
  type MapCategory,
  maps,
} from "@openfront/engine-api/game/GameTypes";
import { buildAssetUrl } from "@openfront/shared/AssetPaths";
import type { Express } from "express";
import en from "resources/lang/en.json";
import type { Logger } from "winston";
import { publicOrigin } from "./auth/config";
import { escapeHtml } from "./GamePreviewBuilder";
import { readMapFile } from "./MapFiles";
import { calculateMapPlayerCounts } from "./MapPlayerCounts";
import { PRIME_TIME_MAPS } from "./MapPlaylist";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";
import { type HeadMeta, injectHeadMeta } from "./SeoMeta";
import { ServerEnv } from "./ServerEnv";

// Server-rendered landing pages for search engines: the full text is in the
// HTML, so a crawler that runs no script reads it. Like the press page they
// are English only and live outside the app shell.

const OPENFRONT_URL = "https://openfront.io";
const OPENFRONT_SOURCE_URL = "https://github.com/openfrontio/OpenFrontIO";
const SOURCE_URL = "https://github.com/hatemets/landwar-source";

const CACHE_CONTROL = "public, max-age=3600";

const MAP_NAMES = en.map as Record<string, string>;
const CATEGORY_NAMES = en.map_categories as Record<string, string>;
// Picker groups, not places: a map page names its region or kind.
const HIDDEN_CATEGORIES: readonly MapCategory[] = ["featured", "new"];
// How many nation names a map page lists.
const MAX_NATION_NAMES = 40;

export interface SeoMap {
  slug: string;
  id: GameMapName;
  type: GameMapType;
  name: string;
  categories: MapCategory[];
  nationCount: number;
  primeTime: boolean;
}

export function mapSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Every map a player can pick, by name. Tournament maps are left out: they
// are copies of other maps for organised events.
export const SEO_MAPS: readonly SeoMap[] = maps
  .filter((m) => m.categories.some((c) => c !== "tournament"))
  .map((m) => {
    const name = MAP_NAMES[m.translationKey.replace(/^map\./, "")] ?? m.type;
    return {
      slug: mapSlug(name),
      id: m.id,
      type: m.type,
      name,
      categories: m.categories.filter((c) => !HIDDEN_CATEGORIES.includes(c)),
      nationCount: m.defaultNationCount,
      primeTime: PRIME_TIME_MAPS.includes(m.type),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const MAPS_BY_SLUG = new Map(SEO_MAPS.map((m) => [m.slug, m]));

export const OPENFRONT_ALTERNATIVE_PATH = "/openfront-alternative";
export const GAMES_LIKE_OPENFRONT_PATH = "/games-like-openfront";
export const MAPS_PATH = "/maps";

export function mapPagePath(map: SeoMap): string {
  return `${MAPS_PATH}/${map.slug}`;
}

// The pages this module serves, for the sitemap.
export const SEO_PAGE_PATHS: readonly string[] = [
  OPENFRONT_ALTERNATIVE_PATH,
  GAMES_LIKE_OPENFRONT_PATH,
  MAPS_PATH,
  ...SEO_MAPS.map(mapPagePath),
];

// What a map page reads from the map's manifest.
export interface MapFacts {
  landTiles: number;
  nations: string[];
}

export async function readMapFacts(map: GameMapType): Promise<MapFacts> {
  const raw = (await readMapFile(map, "manifest.json")).toString("utf8");
  const manifest = JSON.parse(raw) as {
    map: { num_land_tiles: number };
    nations?: { name: string }[];
  };
  return {
    landTiles: manifest.map.num_land_tiles,
    nations: (manifest.nations ?? []).map((n) => n.name),
  };
}

export interface PageContext {
  origin: string;
  // Absolute URL of a static asset (CDN in production).
  assetUrl: (path: string) => string;
}

function categoryLabel(c: MapCategory): string {
  return CATEGORY_NAMES[c] ?? c;
}

function mapThumbnailUrl(ctx: PageContext, map: SeoMap): string {
  return ctx.assetUrl(`maps/${map.id.toLowerCase()}/thumbnail.webp`);
}

function screenshotUrl(ctx: PageContext): string {
  return ctx.assetUrl("images/GameplayScreenshot.png");
}

function link(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}

const STYLE = `
body {
  margin: 0;
  background: #0a0f1a;
  color: #e8ecf4;
  font: 16px/1.6 system-ui, sans-serif;
}
a { color: #a9c8fb; }
header, main, footer {
  max-width: 880px;
  margin: 0 auto;
  padding: 0 16px;
}
header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  align-items: center;
  padding-top: 20px;
  padding-bottom: 20px;
}
header .brand { font-weight: 700; color: #e8ecf4; text-decoration: none; }
h1 { font-size: 32px; line-height: 1.2; margin: 24px 0 16px; }
h2 { font-size: 22px; margin: 40px 0 12px; }
.play {
  display: inline-block;
  margin: 16px 0;
  padding: 12px 24px;
  border-radius: 6px;
  background: #3b6fd8;
  color: #fff;
  font-weight: 600;
  text-decoration: none;
}
.facts { list-style: none; padding: 0; }
.facts li { padding: 4px 0; }
.thumb {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  background: #141b2b;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
  list-style: none;
  padding: 0;
}
.grid a { display: block; text-decoration: none; }
.grid img {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 6px;
  background: #141b2b;
}
.grid span { display: block; margin-top: 6px; }
footer {
  margin-top: 64px;
  padding-top: 24px;
  padding-bottom: 40px;
  font-size: 13px;
  color: #9aa6bd;
}
`;

function renderPage(ctx: PageContext, meta: HeadMeta, body: string): string {
  const favicon = ctx.assetUrl("images/Favicon.svg");
  const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="icon" type="image/svg+xml" href="${escapeHtml(favicon)}" />
<style>${STYLE}</style>
</head>
<body>
<header>
<a class="brand" href="/">Kleopolis</a>
${link("/", "Play")}
${link(MAPS_PATH, "Maps")}
${link(OPENFRONT_ALTERNATIVE_PATH, "OpenFront alternative")}
${link(GAMES_LIKE_OPENFRONT_PATH, "Games like OpenFront")}
${link("/leaderboard", "Leaderboard")}
</header>
<main>
${body}
</main>
<footer>
<p>Kleopolis is a fork of ${link(OPENFRONT_URL, "OpenFront")}, licensed under AGPL-3.0. Thanks to the OpenFront team and contributors. ${link(SOURCE_URL, "Kleopolis source code")}.</p>
</footer>
</body>
</html>
`;
  return injectHeadMeta(shell, meta);
}

function pageMeta(
  ctx: PageContext,
  path: string,
  title: string,
  description: string,
  extra: Partial<HeadMeta> = {},
): HeadMeta {
  return {
    title,
    description,
    canonical: new URL(path, ctx.origin).href,
    ogType: "website",
    image: screenshotUrl(ctx),
    twitterCard: "summary_large_image",
    ...extra,
  };
}

const PLAY_BUTTON = `<a class="play" href="/">Play free in your browser</a>`;

// What Kleopolis offers. Each line must stay true of the live game, and the
// page does not say OpenFront lacks it: check before you add to it.
const FEATURES = [
  "No ads. Nothing interrupts a match.",
  `Ranked 1v1 with Elo ratings and a public ${link("/leaderboard", "leaderboard")}.`,
  "Public free-for-all games between signed-in players are rated on their own ladder.",
  "A daily prime-time match: a plain free-for-all on a large real-world map.",
  "Every finished public game keeps a replay that you can share with a link.",
  "Player profiles with stats and recent games.",
];

const FAQ: readonly [string, string][] = [
  [
    "Is Kleopolis free?",
    "Yes. Kleopolis is free to play in the browser, with no download and no ads.",
  ],
  [
    "Is Kleopolis related to OpenFront?",
    "Yes. Kleopolis is a fork of OpenFront, an open-source game licensed under AGPL-3.0. It uses the OpenFront game engine and maps. The OpenFront team does not run Kleopolis.",
  ],
  [
    "Do I need an account?",
    "No. You can play as a guest. Sign in with Google to play ranked matches and keep your stats.",
  ],
  [
    "Can I play alone?",
    "Yes. Solo games put you against AI nations on any map.",
  ],
  [
    "Are all players in public games real people?",
    "Not always. When few players are online, public games also include AI players.",
  ],
];

export function openfrontAlternativePage(ctx: PageContext): string {
  const meta = pageMeta(
    ctx,
    OPENFRONT_ALTERNATIVE_PATH,
    "OpenFront alternative: Kleopolis, a free territory strategy game",
    "Kleopolis is an open-source fork of OpenFront: real-time territory strategy in your browser, with no ads, ranked 1v1 and shareable replays.",
    {
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ.map(([q, a]) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    },
  );
  const body = `
<h1>Kleopolis: an OpenFront alternative</h1>
<p>Kleopolis is a free real-time strategy game in your browser. You expand your territory, build an economy, make alliances and conquer the map against other players and AI nations.</p>
<p>Kleopolis is a fork of ${link(OPENFRONT_URL, "OpenFront")}. OpenFront is ${link(OPENFRONT_SOURCE_URL, "open source")} under AGPL-3.0, and Kleopolis builds on its game engine and maps. We credit the OpenFront team and contributors, and our ${link(SOURCE_URL, "source code")} is public too.</p>
${PLAY_BUTTON}
<h2>What is the same</h2>
<p>The core game is the one OpenFront players know: real-time territory control, gold, cities, ports, defenses, warships, missiles and alliances. Kleopolis has ${SEO_MAPS.length} ${link(MAPS_PATH, "maps")}, from the whole world to single countries and fictional islands.</p>
<h2>What Kleopolis focuses on</h2>
<ul>
${FEATURES.map((d) => `<li>${d}</li>`).join("\n")}
</ul>
<h2>Which one should you play?</h2>
<p>Both games are free. OpenFront has a larger player base and its own community. Kleopolis is for players who want a game without ads and with a focus on ranked play. You can play both.</p>
<h2>Questions</h2>
${FAQ.map(([q, a]) => `<h3>${escapeHtml(q)}</h3>\n<p>${escapeHtml(a)}</p>`).join("\n")}
<p>${link(GAMES_LIKE_OPENFRONT_PATH, "More games like OpenFront")}</p>
`;
  return renderPage(ctx, meta, body);
}

function mapLinks(list: readonly SeoMap[]): string {
  return list.map((m) => `<li>${link(mapPagePath(m), m.name)}</li>`).join("\n");
}

export function gamesLikeOpenfrontPage(ctx: PageContext): string {
  const meta = pageMeta(
    ctx,
    GAMES_LIKE_OPENFRONT_PATH,
    "Games like OpenFront: real-time territory strategy in your browser",
    "Like OpenFront? Kleopolis is a free browser strategy game in the same style: claim land in real time, build an economy and fight for a real-world map.",
  );
  const primeTime = SEO_MAPS.filter((m) => m.primeTime);
  const body = `
<h1>Games like OpenFront</h1>
<p>OpenFront is a real-time territory game: every player starts with a small patch of land on a map and grows by attacking neighbours. It plays like a fast, live version of Risk in the browser, with an economy, alliances and naval and missile warfare on top.</p>
<p>If that is the game you like, these are the features to look for in another one:</p>
<ul>
<li>Real time, not turn-based: many players expand at once.</li>
<li>Territory as the main resource: more land means more troops and gold.</li>
<li>Real-world maps, so geography decides where you are safe.</li>
<li>Diplomacy: alliances that you can keep or break.</li>
<li>Instant play in the browser, with no download.</li>
</ul>
<h2>Kleopolis</h2>
<p>Kleopolis is a fork of ${link(OPENFRONT_URL, "OpenFront")}, so it has all of the features above. It has ranked 1v1, a daily prime-time match and shareable replays, with no ads. Read more in ${link(OPENFRONT_ALTERNATIVE_PATH, "Kleopolis as an OpenFront alternative")}.</p>
${PLAY_BUTTON}
<h2>Other games in the genre</h2>
<ul>
<li>Territorial.io: short real-time territory matches in the browser.</li>
<li>WarFront.io: the game that OpenFront started from.</li>
<li>Board strategy games such as Risk, if you prefer turns to real time.</li>
</ul>
<h2>Start with a real-world map</h2>
<ul>
${mapLinks(primeTime)}
</ul>
<p>${link(MAPS_PATH, `See all ${SEO_MAPS.length} maps`)}</p>
`;
  return renderPage(ctx, meta, body);
}

function mapCard(ctx: PageContext, m: SeoMap): string {
  return `<li><a href="${escapeHtml(mapPagePath(m))}"><img src="${escapeHtml(mapThumbnailUrl(ctx, m))}" alt="${escapeHtml(`${m.name} map`)}" loading="lazy" width="160" height="120" /><span>${escapeHtml(m.name)}</span></a></li>`;
}

export function mapIndexPage(ctx: PageContext): string {
  const meta = pageMeta(
    ctx,
    MAPS_PATH,
    "Maps - Kleopolis",
    `All ${SEO_MAPS.length} Kleopolis maps: the world, continents, countries, seas and fictional lands. Pick one and play free in your browser.`,
  );
  const primeTime = SEO_MAPS.filter((m) => m.primeTime);
  const body = `
<h1>Kleopolis maps</h1>
<p>Kleopolis has ${SEO_MAPS.length} maps. Each map is a real place or a fictional land. Large real-world maps host the daily prime-time match.</p>
${PLAY_BUTTON}
<h2>Prime-time maps</h2>
<ul class="grid">
${primeTime.map((m) => mapCard(ctx, m)).join("\n")}
</ul>
<h2>All maps</h2>
<ul class="grid">
${SEO_MAPS.map((m) => mapCard(ctx, m)).join("\n")}
</ul>
`;
  return renderPage(ctx, meta, body);
}

// Up to `limit` other maps that share a category with `map`.
function relatedMaps(map: SeoMap, limit: number): SeoMap[] {
  return SEO_MAPS.filter(
    (m) =>
      m.slug !== map.slug &&
      m.categories.some((c) => map.categories.includes(c)),
  ).slice(0, limit);
}

export function mapPage(
  ctx: PageContext,
  map: SeoMap,
  facts: MapFacts | null,
): string {
  const players = facts ? calculateMapPlayerCounts(facts.landTiles)[0] : null;
  const kinds = map.categories.map(categoryLabel);
  const summary = [
    `Play the ${map.name} map in Kleopolis, a free real-time strategy game in your browser.`,
  ];
  if (players !== null) summary.push(`Up to ${players} players.`);
  if (map.nationCount > 0) summary.push(`${map.nationCount} AI nations.`);
  const description = summary.join(" ");

  const factItems: string[] = [];
  if (kinds.length > 0) factItems.push(`Type: ${kinds.join(", ")}`);
  if (players !== null) factItems.push(`Players: up to ${players}`);
  if (map.nationCount > 0) factItems.push(`AI nations: ${map.nationCount}`);
  if (map.primeTime) factItems.push("In the daily prime-time match rotation");

  const nations = facts?.nations.slice(0, MAX_NATION_NAMES) ?? [];
  const nationText =
    nations.length > 0
      ? `<h2>Nations on ${escapeHtml(map.name)}</h2>
<p>${escapeHtml(nations.join(", "))}${(facts?.nations.length ?? 0) > nations.length ? ", and more" : ""}.</p>`
      : "";
  const related = relatedMaps(map, 8);
  const relatedText =
    related.length > 0
      ? `<h2>Similar maps</h2>
<ul>
${mapLinks(related)}
</ul>`
      : "";

  const thumb = mapThumbnailUrl(ctx, map);
  const meta = pageMeta(
    ctx,
    mapPagePath(map),
    `${map.name} map - Kleopolis`,
    description,
    {
      image: thumb,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { name: "Kleopolis", path: "/" },
          { name: "Maps", path: MAPS_PATH },
          { name: map.name, path: mapPagePath(map) },
        ].map((item, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: item.name,
          item: new URL(item.path, ctx.origin).href,
        })),
      },
    },
  );
  const body = `
<p>${link(MAPS_PATH, "Maps")} / ${escapeHtml(map.name)}</p>
<h1>${escapeHtml(map.name)}</h1>
<img class="thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(`${map.name} map`)}" />
<p>${escapeHtml(description)}</p>
<ul class="facts">
${factItems.map((f) => `<li>${escapeHtml(f)}</li>`).join("\n")}
</ul>
${PLAY_BUTTON}
${nationText}
${relatedText}
<p>${link(OPENFRONT_ALTERNATIVE_PATH, "About Kleopolis and OpenFront")}</p>
`;
  return renderPage(ctx, meta, body);
}

function notFoundPage(ctx: PageContext): string {
  return renderPage(
    ctx,
    {
      title: "Map not found - Kleopolis",
      description: "This Kleopolis map does not exist.",
      noindex: true,
    },
    `<h1>Map not found</h1>\n<p>${link(MAPS_PATH, "See all maps")}</p>`,
  );
}

async function pageContext(): Promise<PageContext> {
  const origin = publicOrigin();
  const manifest = await getRuntimeAssetManifest();
  const cdnBase = ServerEnv.cdnBase();
  return {
    origin,
    assetUrl: (path) =>
      new URL(buildAssetUrl(path, manifest, cdnBase), origin).href,
  };
}

/**
 * Serve the landing pages. The content only changes with a deploy, so each
 * page is rendered once and kept. Register before the static handler: it
 * would answer `/maps/<map>` from the map asset folders.
 */
export function registerSeoPages(
  app: Express,
  opts: {
    log?: Pick<Logger, "warn" | "error">;
    // For tests. Defaults to the map's manifest file.
    loadMapFacts?: (map: GameMapType) => Promise<MapFacts>;
  } = {},
): void {
  const loadFacts = opts.loadMapFacts ?? readMapFacts;
  const rendered = new Map<string, Promise<string>>();

  // A failed render is not kept, so the next request tries again.
  function cached(key: string, render: () => Promise<string>) {
    let page = rendered.get(key);
    if (page === undefined) {
      page = render();
      rendered.set(key, page);
      page.catch(() => rendered.delete(key));
    }
    return page;
  }

  function serve(path: string, render: (ctx: PageContext) => string) {
    app.get(path, async (_req, res) => {
      try {
        const html = await cached(path, async () =>
          render(await pageContext()),
        );
        res.setHeader("Cache-Control", CACHE_CONTROL);
        res.type("html").send(html);
      } catch (error) {
        opts.log?.error("failed to render an SEO page", { path, error });
        res.status(500).send("Internal Server Error");
      }
    });
  }

  serve(OPENFRONT_ALTERNATIVE_PATH, openfrontAlternativePage);
  serve(GAMES_LIKE_OPENFRONT_PATH, gamesLikeOpenfrontPage);
  serve(MAPS_PATH, mapIndexPage);

  app.get(`${MAPS_PATH}/:slug`, async (req, res) => {
    const map = MAPS_BY_SLUG.get(req.params.slug);
    if (map === undefined) {
      try {
        res
          .status(404)
          .type("html")
          .send(notFoundPage(await pageContext()));
      } catch (error) {
        opts.log?.error("failed to render the map 404 page", { error });
        res.status(404).send("Not Found");
      }
      return;
    }
    try {
      // Without the manifest the page leaves out the player count and the
      // nations, and is not kept, so a later request tries the read again.
      const html = await cached(mapPagePath(map), async () =>
        mapPage(await pageContext(), map, await loadFacts(map.type)),
      ).catch(async (error: unknown) => {
        opts.log?.warn("SEO map page: manifest read failed", {
          map: map.type,
          error,
        });
        return mapPage(await pageContext(), map, null);
      });
      res.setHeader("Cache-Control", CACHE_CONTROL);
      res.type("html").send(html);
    } catch (error) {
      opts.log?.error("failed to render a map page", { map: map.type, error });
      res.status(500).send("Internal Server Error");
    }
  });
}
