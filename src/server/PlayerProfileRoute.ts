import type { Express } from "express";
import type { Logger } from "winston";
import { publicOrigin } from "./auth/config";
import { db } from "./db";
import { getAppShellContent, setAppShellCacheHeaders } from "./RenderHtml";
import {
  type HeadMeta,
  injectHeadMeta,
  playerPageUrl,
  resolveShellPath,
} from "./SeoMeta";
import { profileSummary, type ProfileSummary } from "./stats/seoQueries";

// The same shape the client accepts (PlayerProfileUrl.ts).
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,22}$/;

const LADDER_LABELS: Record<string, string> = {
  "1v1": "1v1",
  "3v3": "3v3",
  "5v5": "5v5",
  ffa: "free-for-all",
};

export function profileHeadMeta(
  origin: string,
  profile: ProfileSummary,
): HeadMeta {
  const name = profile.displayName;
  const { gamesPlayed, wins, rating } = profile;
  const parts = [
    `${name} has played ${gamesPlayed} ${gamesPlayed === 1 ? "game" : "games"} of Kleopolis and won ${wins}`,
  ];
  if (gamesPlayed > 0) {
    parts[0] += ` (${Math.round((wins / gamesPlayed) * 100)}% win rate)`;
  }
  if (rating !== null) {
    const ladder = LADDER_LABELS[rating.ladder] ?? rating.ladder;
    parts.push(`${ladder} Elo: ${rating.elo}`);
  }
  const description = `${parts.join(". ")}. See their stats and recent games.`;
  return {
    title: `${name} - Kleopolis player profile`,
    description,
    canonical: playerPageUrl(origin, profile.publicId),
    ogType: "profile",
    twitterCard: "summary",
  };
}

const NOT_FOUND_META: HeadMeta = {
  title: "Player not found - Kleopolis",
  description: "This Kleopolis player does not exist.",
  noindex: true,
};

/**
 * Serve the app shell at `/player/<publicId>`, the canonical profile link: the
 * client opens that player's profile on load (see playerProfileUrl). The head
 * names the player and their stats, for search engines and link previews.
 *
 * The master registers it ahead of its SPA fallback, so the bare
 * `/player/<id>` link gets the tags. The worker registers it for the
 * worker-prefixed form (`/w<n>/player/<id>`, stripped of its prefix before
 * routing). An unknown player gets the shell with `noindex` and a 404. When
 * the database can't be read, the plain shell is served as is.
 */
export function registerPlayerProfileRoute(opts: {
  app: Express;
  log: Logger;
  baseDir: string;
  // For tests. Defaults to the database.
  loadProfile?: (publicId: string) => Promise<ProfileSummary | null>;
}) {
  const { app, log, baseDir } = opts;
  const loadProfile =
    opts.loadProfile ?? ((id: string) => profileSummary(db().db, id));

  // Express matches a trailing slash too (non-strict routing).
  app.get("/player/:publicId", async (req, res) => {
    try {
      const htmlPath = await resolveShellPath(baseDir);
      if (htmlPath === null) throw new Error("app shell not found");
      const shell = await getAppShellContent(htmlPath);

      const publicId = req.params.publicId;
      let profile: ProfileSummary | null = null;
      if (PUBLIC_ID.test(publicId)) {
        try {
          profile = await loadProfile(publicId);
        } catch (error) {
          log.warn("failed to read a player for the profile page", {
            error,
          });
          setAppShellCacheHeaders(res);
          res.send(shell);
          return;
        }
      }

      setAppShellCacheHeaders(res);
      if (profile === null) {
        res.status(404).send(injectHeadMeta(shell, NOT_FOUND_META));
        return;
      }
      res.send(injectHeadMeta(shell, profileHeadMeta(publicOrigin(), profile)));
    } catch (error) {
      log.error("failed to render the app shell for a profile link", {
        error,
      });
      res.status(500).send("Internal Server Error");
    }
  });
}
