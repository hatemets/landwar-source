import { GAME_ID_REGEX } from "@openfront/engine-api/Schemas";
import { replacer } from "@openfront/shared/SharedUtil";
import { GameInfo } from "@openfront/shared/WireSchemas";
import type { Express, Request } from "express";
import type { Logger } from "winston";
import { z } from "zod";
import { db } from "./db";
import type { GameManager } from "./GameManager";
import { publicOrigin } from "./auth/config";
import {
  buildPreview,
  ExternalGameInfo,
  ExternalGameInfoSchema,
} from "./GamePreviewBuilder";
import { loadGameRecord } from "./GameStore";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { getAppShellContent, setHtmlNoCacheHeaders } from "./RenderHtml";
import { gamePageUrl, injectHeadMeta, resolveShellPath } from "./SeoMeta";
import { ServerEnv } from "./ServerEnv";

const requestOrigin = (req: Request): string => {
  const protoHeader = (req.headers["x-forwarded-proto"] as string) ?? "";
  const proto = protoHeader.split(",")[0]?.trim() || req.protocol || "https";
  const host =
    req.get("host") ?? `${ServerEnv.subdomain()}.${ServerEnv.domain()}`;

  // Force https only for the configured public domain (and its subdomains).
  // This avoids hardcoding hostnames while ensuring we don't force https on
  // localhost or arbitrary custom hosts.
  const hostname = host.split(":")[0].toLowerCase();
  const domain = ServerEnv.domain().toLowerCase();
  const forceHttps = hostname === domain || hostname.endsWith(`.${domain}`);

  return `${forceHttps ? "https" : proto}://${host}`;
};

export function registerGamePreviewRoute(opts: {
  app: Express;
  gm: GameManager;
  workerId: number;
  log: Logger;
  baseDir: string;
}) {
  const { app, gm, log, baseDir } = opts;

  const gameIDSchema = z.string().regex(GAME_ID_REGEX);

  const fetchPublicGameInfo = async (
    gameID: string,
  ): Promise<ExternalGameInfo | null> => {
    if (!gameIDSchema.safeParse(gameID).success) return null;

    try {
      const record = await loadGameRecord(db().db, gameID);
      if (record === null) return null;
      const parsed = ExternalGameInfoSchema.safeParse(record);
      if (!parsed.success) {
        log.warn("Invalid archived game info", {
          gameID,
          issues: parsed.error.issues,
        });
        return null;
      }
      return parsed.data;
    } catch (error) {
      log.warn("failed to read archived game info", { gameID, error });
      return null;
    }
  };

  app.get("/game/:id", async (req, res) => {
    const gameID = req.params.id;

    // Validate gameID format
    if (!GAME_ID_REGEX.test(gameID)) {
      return res.status(400).json({ error: "Invalid game ID format" });
    }

    const game = gm.game(gameID);

    const lobby: GameInfo | null = game ? game.gameInfo() : null;

    try {
      const publicInfo = await fetchPublicGameInfo(gameID); // Read the archived record from the database

      // If we have neither live lobby info nor archived public info, we can't show anything
      if (!lobby && !publicInfo) {
        return res.redirect(302, "/");
      }

      const origin = requestOrigin(req);
      const meta = await buildPreview(
        gameID,
        origin,
        ServerEnv.workerPath(gameID),
        lobby,
        publicInfo,
      );

      // Always serve HTML with meta tags for /game/:id route
      const filePath = await resolveShellPath(baseDir);
      if (filePath) {
        const html = await getAppShellContent(filePath);
        const gameType =
          lobby?.gameConfig?.gameType ?? publicInfo?.info?.config?.gameType;
        const description = meta.description || meta.title;
        const page = injectHeadMeta(html, {
          title: `${meta.title} - Kleopolis`,
          description,
          canonical: gamePageUrl(publicOrigin(), gameID),
          url: meta.joinUrl,
          ogType: "website",
          image: meta.image,
          twitterCard: "summary_large_image",
          // Private games stay out of search results.
          noindex: gameType !== undefined && gameType !== "Public",
        });

        setHtmlNoCacheHeaders(res);
        return res.status(200).send(page);
      }

      // Fallback to JSON if HTML file not found
      setNoStoreHeaders(res);
      res.setHeader("Content-Type", "application/json");
      return res.send(JSON.stringify(lobby ?? publicInfo, replacer));
    } catch (error) {
      log.error("failed to render join preview", { error });
      return res.status(500).send("Unable to render lobby preview");
    }
  });
}
