import { playerRatings } from "@landwar/db/schema";
import { and, eq } from "drizzle-orm";
import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import { WebSocketServer } from "ws";
import { verifyJoinToken } from "../auth/joinToken";
import { findUserById } from "../auth/users";
import { db } from "../db";
import { logger } from "../Logger";
import type { MasterLobbyService } from "../MasterLobbyService";
import { ServerEnv } from "../ServerEnv";
import { START_ELO } from "../stats/elo";
import { MATCH_JOIN_DEADLINE_SECONDS, matchGameConfig } from "./matchConfig";
import type { QueueMode } from "./matcher";
import { type Identity, Matchmaker, type QueueSocket } from "./Matchmaker";

const log = logger.child({ comp: "matchmaking" });

const TICK_MS = 1000;
const PATH = "/matchmaking/join";

function parseMode(url: string | undefined): QueueMode | null {
  const mode = new URL(url ?? "", "http://localhost").searchParams.get("mode");
  // The client omits the mode for 1v1.
  return mode === null || mode === "1v1" ? "1v1" : null;
}

// The queue the master runs. Players connect over a WebSocket, and a match
// becomes an invite-only game on a worker.
export function startMatchmaking(
  server: Server,
  lobbies: Pick<MasterLobbyService, "createMatchGame">,
): { matchmaker: Matchmaker; stop: () => void } {
  const matchmaker = new Matchmaker({
    async identify(jwt): Promise<Identity | null> {
      const result = await verifyJoinToken(jwt);
      // Ranked is for accounts. A guest has no rating to keep.
      if (result.type !== "success" || result.claims.kind !== "user") {
        return null;
      }
      const user = await findUserById(db().db, result.claims.sub);
      return user ? { userId: user.id, publicId: user.publicId } : null;
    },
    async rating(userId, mode) {
      const rows = await db()
        .db.select({ elo: playerRatings.elo })
        .from(playerRatings)
        .where(
          and(eq(playerRatings.userId, userId), eq(playerRatings.ladder, mode)),
        )
        .limit(1);
      return rows[0]?.elo ?? START_ELO;
    },
    async createGame(mode, match) {
      const gameID = ServerEnv.generateGameId();
      lobbies.createMatchGame({
        gameID,
        gameConfig: matchGameConfig(mode, match),
        startsAt: Date.now() + MATCH_JOIN_DEADLINE_SECONDS * 1000,
      });
      log.info("ranked match made", {
        gameID,
        mode,
        players: match.players.length,
      });
      return gameID;
    },
    now: () => Date.now(),
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== PATH) return;
    const mode = parseMode(req.url);
    if (mode === null) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      matchmaker.connect(ws as unknown as QueueSocket, mode);
    });
  };
  server.on("upgrade", onUpgrade);

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    matchmaker
      .tick()
      .catch((error) =>
        log.error("matchmaking tick failed", { error: String(error) }),
      )
      .finally(() => (running = false));
  }, TICK_MS);

  return {
    matchmaker,
    stop: () => {
      clearInterval(timer);
      server.off("upgrade", onUpgrade);
      wss.close();
    },
  };
}
