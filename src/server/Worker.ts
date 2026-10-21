import { ID, isValidGameID } from "@openfront/engine-api/Schemas";
import { CloseCode, CloseReason } from "@openfront/shared/CloseCodes";
import { generateID, replacer } from "@openfront/shared/SharedUtil";
import {
  ClientMessage,
  ClientPlatformSchema,
  HOSTED_LOBBY_AUTO_START_MS,
  MAX_HOSTED_LOBBIES,
  MAX_HOSTED_LOBBY_PLAYERS,
  MIN_HOSTED_LOBBY_AUTO_START_MS,
  MIN_HOSTED_LOBBY_PLAYERS,
  ServerErrorMessage,
} from "@openfront/shared/WireSchemas";
import {
  CreateGameInputSchema,
  isPrivateGameInput,
} from "@openfront/shared/WorkerSchemas";
import {
  decodeClientMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import compression from "compression";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import ipAnonymize from "ip-anonymize";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { registerAdminBotRoutes } from "./AdminBotRoutes";
import { findUserById } from "./auth/users";
import { censorPlayer } from "./Censor";
import { Client } from "./Client";
import { clientIp, TRUSTED_PROXY_HOPS } from "./ClientIp";
import { db } from "./db";
import { gameApiCors } from "./GameApiCors";
import { GameManager } from "./GameManager";
import { registerGamePreviewRoute } from "./GamePreviewRoute";
import type { GameServer } from "./GameServer";
import { verifyClientToken } from "./jwt";
import { canCreateLobby, canJoinLobby, canListLobby } from "./LobbyRules";
import { logger } from "./Logger";
import { registerPlayerProfileRoute } from "./PlayerProfileRoute";
import { resolveJoinCosmetics } from "./shop/joinCosmetics";

import { setNoStoreHeaders } from "./NoStoreHeaders";
import { rejoinOrClose } from "./Rejoin";
import { ServerEnv } from "./ServerEnv";
import { SingleplayerPresence } from "./SingleplayerPresence";
import { applyStaticAssetCacheControl } from "./StaticAssetCache";
import { noopMatchTelemetryEmitter } from "./telemetry/MatchTelemetry";
import { MAX_WEBSOCKET_PAYLOAD_BYTES } from "./WebSocketLimits";
import { WorkerLobbyService } from "./WorkerLobbyService";
import { stripWorkerPrefix } from "./WorkerPathPrefix";

const workerId = ServerEnv.workerId() ?? 0;
const log = logger.child({ comp: `w_${workerId}` });

// Worker setup
export async function startWorker() {
  log.info(`Worker starting...`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const server = http.createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
  });

  const buildHash = ServerEnv.gitCommit();
  const gm = new GameManager(log, noopMatchTelemetryEmitter, buildHash);

  // Initialize lobby service (handles WebSocket upgrade routing)
  const lobbyService = new WorkerLobbyService(server, wss, gm, log);
  const singleplayerPresence = new SingleplayerPresence();

  // Ahead of everything that can reject a request — the worker-prefix check
  // below and the rate limiter further down — so that a 404 or a 429 still
  // carries the CORS headers. Without them the desktop client sees an opaque
  // CORS failure instead of the real status, which hides the actual fault.
  // Matches both URL shapes because it runs before the prefix is stripped,
  // including a prefix naming a different worker.
  app.use(["/api", /^\/w\d+\/api/], gameApiCors);

  app.use(stripWorkerPrefix(workerId));

  app.set("trust proxy", TRUSTED_PROXY_HOPS);
  app.use(compression());

  app.use(
    express.static(path.join(__dirname, "../../out"), {
      setHeaders: (res) => {
        applyStaticAssetCacheControl(
          res.setHeader.bind(res),
          res.req.originalUrl,
        );
      },
    }),
  );
  app.use(
    "/maps",
    express.static(path.join(__dirname, "../../static/maps"), {
      maxAge: "1y",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".webp")) {
          res.setHeader("Content-Type", "image/webp");
        }
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: 1000, // 1 second
      max: 20, // 20 requests per IP per second
    }),
  );

  app.use("/api", (_req, res, next) => {
    setNoStoreHeaders(res);
    next();
  });

  // Create a new private game. The worker mints an id that belongs to itself
  // and returns it, so callers don't need to know the sharding. nginx (and the
  // vite dev proxy) randomly route here to spread new games across workers.
  app.post("/api/create_game", async (req, res) => {
    // Identify the creator from their token. Never accept persistentID directly.
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(400)
        .json({ error: "Authorization header required to create a game" });
    }
    const auth = await verifyClientToken(
      authHeader.substring("Bearer ".length),
    );
    if (auth.type !== "success") {
      log.warn(`Invalid creator token: ${auth.message}`);
      return res.status(401).json({ error: "Invalid creator token" });
    }
    // Creating a lobby needs an account. A guest token cannot create one.
    if (!canCreateLobby(auth.kind)) {
      return res.status(403).json({ error: "login_required" });
    }
    const creatorPersistentID = auth.persistentId;

    const parsed = CreateGameInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const gc = parsed.data;
    // Only private games are created here. Public games are scheduled by the
    // master over IPC, and singleplayer games run in the browser, never on a
    // game server. An empty body ({}) parses to undefined and gets
    // createGame's private default.
    if (!isPrivateGameInput(gc)) {
      return res
        .status(400)
        .json({ error: "Only private games can be created via this endpoint" });
    }

    // Reuse-lobby flow: ?previous=<gameID> marks this creation as the successor
    // of a finished private game, so its remaining players get told the new id
    // and can hop over without re-sharing a link. The previous game lives on
    // this same worker (callers hit /wX/api/create_game for it), which is also
    // where the successor is minted. Going through this endpoint (instead of a
    // websocket message) keeps game creation behind its rate limits.
    let previousGame: GameServer | null = null;
    if (req.query.previous !== undefined) {
      const prevId = ID.safeParse(req.query.previous);
      if (!prevId.success) {
        return res.status(400).json({ error: "Invalid previous game id" });
      }
      previousGame = gm.game(prevId.data);
      if (previousGame === null) {
        return res.status(404).json({ error: "Previous game not found" });
      }
      if (!previousGame.isCreator(creatorPersistentID)) {
        return res.status(403).json({
          error: "Only the lobby creator can create a successor lobby",
        });
      }
      // Reusing a lobby is a private-lobby feature: a public game's players
      // never opted into following a host to another game.
      if (previousGame.isPublic()) {
        return res
          .status(403)
          .json({ error: "Public games cannot spawn a successor lobby" });
      }
      // Idempotent: a repeat request (e.g. a double click) reuses the already
      // minted successor instead of creating another one.
      const existingId = previousGame.successorLobby();
      const existing = existingId !== null ? gm.game(existingId) : null;
      if (existingId !== null && existing !== null) {
        previousGame.setSuccessorLobby(existingId); // re-broadcast for late joiners
        return res.json({
          ...existing.gameInfo(),
          workerIndex: workerId,
          workerPath: ServerEnv.workerPath(existingId),
        });
      }
      // A recorded successor that no longer exists (already cleaned up) falls
      // through and gets replaced by a fresh lobby.
    }

    const id = ServerEnv.generateGameIdForWorker(workerId);
    if (id === null) {
      log.warn(`Failed to mint game id on worker ${workerId}`);
      return res.status(500).json({ error: "Could not allocate game id" });
    }

    const game = gm.createGame(id, gc, creatorPersistentID);
    if (game === null) {
      log.warn(`cannot create game, id ${id} already exists`);
      return res.status(409).json({ error: "Game ID already exists" });
    }

    // Tell the previous game about its successor: it remembers the id (for
    // idempotency) and broadcasts it to everyone still connected. Done after
    // creation so a failed creation never broadcasts a dead id.
    previousGame?.setSuccessorLobby(id);

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const clientIP = req.ip || req.socket.remoteAddress || "unknown";
    log.info(
      `Worker ${workerId}: IP ${ipAnonymize(clientIP)} creating private${gc?.gameMode ? ` ${gc.gameMode}` : ""} game with id ${id}, creator: ${creatorPersistentID.substring(0, 8)}...`,
    );
    res.json({
      ...game.gameInfo(),
      workerIndex: workerId,
      workerPath: ServerEnv.workerPath(id),
    });
  });

  // Toggle whether a private lobby is visible in the public lobby browser.
  // Creator-only; listing requires an active subscription (checked fresh
  // against the API) and is limited to one listed lobby per creator.
  app.post("/api/game/:id/listing", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(400).json({ error: "Authorization header required" });
    }
    const token = authHeader.substring("Bearer ".length);
    const auth = await verifyClientToken(token);
    if (auth.type !== "success") {
      return res.status(401).json({ error: "Invalid token" });
    }

    const parsed = z
      .object({
        listed: z.boolean(),
        autoStartMs: z
          .number()
          .int()
          .min(MIN_HOSTED_LOBBY_AUTO_START_MS)
          .max(HOSTED_LOBBY_AUTO_START_MS)
          .optional(),
        maxPlayers: z
          .number()
          .int()
          .min(MIN_HOSTED_LOBBY_PLAYERS)
          .max(MAX_HOSTED_LOBBY_PLAYERS)
          .optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const { listed, autoStartMs, maxPlayers } = parsed.data;

    const game = gm.game(req.params.id);
    if (game === null) {
      return res.status(404).json({ error: "Game not found" });
    }
    if (!game.isCreator(auth.persistentId)) {
      return res
        .status(403)
        .json({ error: "Only the lobby creator can change its listing" });
    }
    if (game.isPublic() || game.hasStarted()) {
      return res.status(409).json({ error: "Game cannot be listed" });
    }
    // Listing is one-way for the host: players recruited from the lobby
    // browser must not lose the lobby they joined. Only the master delists
    // (duplicate creator / cap overflow).
    if (!listed && game.isListed()) {
      return res.status(409).json({ error: "listing_permanent" });
    }

    if (listed) {
      // A whitelisted lobby would be advertised to everyone yet reject every
      // joiner; the whitelist itself is stripped from the broadcast, so
      // browsers could not even tell why.
      if (game.hasJoinWhitelist()) {
        return res.status(409).json({ error: "listing_whitelist_enabled" });
      }

      // Host cheats give the host an asymmetric advantage over players
      // recruited from the lobby browser. Enabling them while listed is
      // likewise rejected (GameServer's update_game_config handling).
      if (game.hasHostCheats()) {
        return res.status(409).json({ error: "listing_host_cheats_enabled" });
      }

      // A cap at or below the current head count would advertise a lobby
      // nobody can join.
      if (maxPlayers !== undefined && maxPlayers <= game.numPlayers()) {
        return res.status(409).json({ error: "listing_max_players_too_low" });
      }

      // Only an account may list a lobby. Phase 3 sets the full lobby rules.
      if (!canListLobby(auth.kind)) {
        return res.status(403).json({ error: "login_required" });
      }

      const creatorID = game.hashedCreatorID();
      if (
        creatorID !== undefined &&
        lobbyService.creatorHasListedLobby(creatorID, game.id)
      ) {
        return res.status(409).json({ error: "listing_limit_reached" });
      }

      // Cluster-wide cap to prevent listing spam. Approximate here (the
      // broadcast lags by ~1s); the master's cap is the backstop.
      if (lobbyService.hostedLobbyCount() >= MAX_HOSTED_LOBBIES) {
        return res.status(409).json({ error: "listing_full" });
      }
    }

    game.setListed(listed, { autoStartMs, maxPlayers });
    log.info(`lobby listing ${listed ? "enabled" : "disabled"}`, {
      gameID: game.id,
      autoStartMs,
      maxPlayers,
    });
    res.json({ listed });
  });

  // Singleplayer games run in the browser; the client beats here once a
  // minute so the worker can export how many are in progress (see
  // SingleplayerPresence). The id is client-minted and routes here by hash,
  // exactly like the game socket would.
  app.post("/api/singleplayer/:id/heartbeat", (req, res) => {
    const gameID = req.params.id;
    if (!isValidGameID(gameID)) {
      res.status(400).json({ error: "Invalid game ID" });
      return;
    }
    const platform = ClientPlatformSchema.safeParse(req.body?.platform);
    singleplayerPresence.heartbeat(
      gameID,
      platform.success ? platform.data : "unknown",
    );
    res.status(204).end();
  });

  app.get("/api/game/:id/exists", async (req, res) => {
    const lobbyId = req.params.id;
    res.json({
      exists: gm.game(lobbyId) !== null,
    });
  });

  app.get("/api/game/:id", async (req, res) => {
    const game = gm.game(req.params.id);
    if (game === null) {
      log.info(`lobby ${req.params.id} not found`);
      return res.status(404).json({ error: "Game not found" });
    }
    res.json(game.gameInfo());
  });

  registerGamePreviewRoute({
    app,
    gm,
    workerId,
    log,
    baseDir: __dirname,
  });

  registerPlayerProfileRoute({ app, log, baseDir: __dirname });

  registerAdminBotRoutes({ app, gm, workerId, log });

  // WebSocket handling
  wss.on("connection", (ws: WebSocket, req) => {
    ws.on("message", async (message: Buffer) => {
      const ip = clientIp(req);

      try {
        // Every frame is zbin (see ZbinWire.ts). Nothing before join carries a
        // dictionary-mapped id, so this decodes without a context.
        let clientMsg: ClientMessage;
        try {
          clientMsg = decodeClientMessage(message, undefined);
        } catch (e) {
          const error = String(e);
          log.warn("Error decoding client message", error);
          ws.send(
            encodeServerMessage(
              {
                type: "error",
                error,
              } satisfies ServerErrorMessage,
              undefined,
            ),
          );
          ws.close(CloseCode.BadRequest, CloseReason.InvalidMessage);
          return;
        }

        if (clientMsg.type === "ping") {
          // Ignore ping
          return;
        } else if (clientMsg.type !== "join" && clientMsg.type !== "rejoin") {
          log.warn(
            `Invalid message before join: ${JSON.stringify(clientMsg, replacer)}`,
          );
          return;
        }

        // Verify this worker should handle this game. Close loudly: the bare
        // return this replaces left the socket open with no reply, so a
        // misrouted client (stale bundle computing a worker index from an old
        // numWorkers) hung forever instead of being told to reload.
        const expectedWorkerId = ServerEnv.workerIndex(clientMsg.gameID);
        if (expectedWorkerId !== workerId) {
          log.warn(
            `Worker mismatch: Game ${clientMsg.gameID} should be on worker ${expectedWorkerId}, but this is worker ${workerId}`,
          );
          ws.close(CloseCode.WrongWorker, CloseReason.WrongWorker);
          return;
        }

        // The sim is deterministic only when every client in a game runs
        // identical code, so a client built from a different commit (e.g. a
        // tab left open across a deploy) would desync the game. Reject it
        // with a typed error the client answers by refreshing. A missing
        // commit means a pre-feature bundle, which is stale by definition.
        // The "desktop" placeholder is exempt: an Electron shell predating
        // OPE-358 injects it no matter how fresh its self-updating bundle is
        // (GameVersion.ts documents the shape as live), so treating it as a
        // mismatch would lock those players out permanently — and the
        // desktop error path is a terminal alert with no retry. The grace
        // dies with the last pre-OPE-358 shell.
        if (
          clientMsg.gitCommit !== ServerEnv.gitCommit() &&
          clientMsg.gitCommit !== "desktop"
        ) {
          log.info("rejecting version-mismatched client", {
            gameID: clientMsg.gameID,
            clientCommit: clientMsg.gitCommit,
          });
          ws.send(
            encodeServerMessage(
              {
                type: "error",
                error: "version_mismatch",
                gitCommit: ServerEnv.gitCommit(),
              } satisfies ServerErrorMessage,
              undefined,
            ),
          );
          // Normal closure: the typed error above is the whole message. The
          // client latches Normal silently, so nothing stacks on the alert; a
          // 4xxx rejection would pop a generic "connection refused" dialog on
          // top of it, and a retryable code makes it reconnect and loop.
          ws.close(CloseCode.Normal, "Version mismatch");
          return;
        }

        // Verify the join token. The server signed it, so no network call is
        // needed here.
        const result = await verifyClientToken(clientMsg.token);
        if (result.type === "error") {
          log.warn(`Invalid token: ${result.message}`, {
            gameID: clientMsg.gameID,
          });
          ws.close(CloseCode.InternalError, CloseReason.InvalidToken);
          return;
        }
        const { persistentId } = result;
        const isAccount = result.kind === "user";

        if (clientMsg.type === "rejoin") {
          log.info("rejoining game", {
            gameID: clientMsg.gameID,
            persistentID: persistentId,
          });
          rejoinOrClose(
            gm,
            log,
            workerId,
            ws,
            persistentId,
            clientMsg.gameID,
            clientMsg.lastTurn,
          );
          return;
        }

        // The join name is screened locally. The closed API name check is not
        // used.
        const censored = censorPlayer(clientMsg.username, null);
        const username = censored.username;
        // LandWar has no clans, so a player never wears a tag.
        const clanTag = null;

        // Reconnect an existing client, for example after a page refresh.
        if (
          gm.rejoinClient(ws, persistentId, clientMsg.gameID, 0, {
            username,
            clanTag,
          })
        ) {
          return;
        }

        // An account gets its public id from the database. A guest has none.
        let publicId: string | undefined;
        if (isAccount) {
          const user = await findUserById(db().db, persistentId);
          if (user === null) {
            log.warn("Unauthorized: join token names an unknown account", {
              persistentID: persistentId,
              gameID: clientMsg.gameID,
            });
            ws.close(CloseCode.Unauthorized, CloseReason.InvalidToken);
            return;
          }
          publicId = user.publicId;
        }

        // Clan tags and cosmetics came from the closed catalog. LandWar does
        // not honour them yet, so the client gets none.
        // A guest may join only a public lobby. A private lobby needs an account.
        if (!isAccount) {
          const target = gm.game(clientMsg.gameID);
          if (
            target !== null &&
            !canJoinLobby("guest", { isPublic: target.isPublic() })
          ) {
            log.warn("Unauthorized: guest attempted to join a private lobby", {
              gameID: clientMsg.gameID,
            });
            ws.close(CloseCode.Unauthorized, CloseReason.LoginRequired);
            return;
          }
        }

        // What the player wears must be owned. A country flag is free.
        const wearing = await resolveJoinCosmetics(
          clientMsg.cosmetics,
          isAccount ? persistentId : null,
        );
        if (!wearing.ok) {
          log.warn("Forbidden: join names a cosmetic the player does not own", {
            gameID: clientMsg.gameID,
          });
          ws.close(CloseCode.Forbidden, CloseReason.CosmeticsForbidden);
          return;
        }

        const client = new Client(
          generateID(),
          persistentId,
          null,
          null,
          undefined,
          ip,
          username,
          clanTag,
          ws,
          wearing.cosmetics,
          publicId,
          [],
          clientMsg.spectator === true,
          false,
          clientMsg.platform,
          undefined,
        );

        const joinResult = gm.joinClient(client, clientMsg.gameID);

        if (joinResult === "not_found") {
          log.info(`game ${clientMsg.gameID} not found on worker ${workerId}`);
          ws.close(CloseCode.GameNotFound, CloseReason.GameNotFound);
        } else if (joinResult === "kicked") {
          log.warn(`kicked client tried to join game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(CloseCode.GameClosed, CloseReason.CannotJoin);
        } else if (joinResult === "not_allowlisted") {
          log.info(`client not whitelisted for game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(CloseCode.Forbidden, CloseReason.NotAllowlisted);
        } else if (joinResult === "not_trusted") {
          log.info(`untrusted client tried to join game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(CloseCode.Forbidden, CloseReason.NotTrusted);
        } else if (joinResult === "redirected") {
          // Normal, not a rejection code: the game already sent this client
          // where to go, and Normal is the client's silent branch, so no
          // dialog appears while it navigates.
          log.info("client redirected to a pool sibling", {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(CloseCode.Normal, CloseReason.PoolRedirect);
        } else if (joinResult === "ended") {
          log.info(`client tried to join ended game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(CloseCode.GameNotFound, CloseReason.GameEnded);
        } else if (joinResult === "rejected") {
          log.info(`client rejected from game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(CloseCode.LobbyFull, CloseReason.LobbyFull);
        } else if (joinResult === "started") {
          log.info(`client joined game ${clientMsg.gameID} after it started`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(CloseCode.GameStarted, CloseReason.GameStarted);
        }

        // Handle other message types
      } catch (error) {
        ws.close(CloseCode.InternalError, CloseReason.InternalError);
        log.warn(
          `error handling websocket message for ${ipAnonymize(ip)}: ${error}`.substring(
            0,
            250,
          ),
        );
      }
    });

    ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        ws.close(CloseCode.ProtocolError, CloseReason.ProtocolError);
      }
    });
    ws.on("close", () => {
      ws.removeAllListeners();
    });
  });

  // The load balancer will handle routing to this server based on path
  const PORT = ServerEnv.workerPortByIndex(workerId);
  server.listen(PORT, () => {
    log.info(`running on http://localhost:${PORT}`);
    log.info(`Handling requests with path prefix /w${workerId}/`);
    // Signal to the master process that this worker is ready
    lobbyService.sendReady(workerId);
    log.info(`signaled ready state to master`);
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error(`Error in ${req.method} ${req.path}:`, err);
    res.status(500).json({ error: "An unexpected error occurred" });
  });

  // Process-level error handlers
  process.on("uncaughtException", (err) => {
    log.error(`uncaught exception:`, err);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error(`unhandled rejection at:`, promise, "reason:", reason);
  });
}
