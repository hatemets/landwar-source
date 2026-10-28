import { runMigrations } from "@kleopolis/db/migrate";
import { GameEnv } from "@openfront/shared/configuration/Env";
import cluster from "cluster";
import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl } from "./auth/config";
import { registerAuthRoutes } from "./auth/routes";
import { registerUsernameRoutes } from "./auth/usernameRoutes";
import {
  applyCheckinState,
  CHECKIN_INTERVAL_MS,
  checkinBody,
  clusterCheckinEnabled,
  isRefusal,
  registeredSite,
  sendCheckin,
} from "./ClusterCheckin";
import { TRUSTED_PROXY_HOPS } from "./ClientIp";
import { registerClusterListRoute } from "./ClusterListRoute";
import { registerFriendsRoutes } from "./friends/routes";
import {
  coordinatorUrl,
  LobbyCoordinatorClient,
} from "./LobbyCoordinatorClient";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { fetchMapWeights, MAP_WEIGHTS_POLL_MS } from "./MapWeights";
import { MasterLobbyService } from "./MasterLobbyService";
import { startMatchmaking } from "./matchmaking/service";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { registerPlayerProfileRoute } from "./PlayerProfileRoute";
import { startPolling } from "./PollingLoop";
import { renderAppShell } from "./RenderHtml";
import { registerServedConfigRoutes } from "./ServedConfigRoutes";
import { ServerEnv } from "./ServerEnv";
import { sendShellPage } from "./ShellPageMeta";
import { registerSeoPages } from "./SeoPages";
import { registerShopRoutes } from "./shop/routes";
import { registerSitemapRoutes } from "./SitemapRoute";
import { applyStaticAssetCacheControl } from "./StaticAssetCache";
import { registerStatsRoutes } from "./stats/routes";

const playlist = new MapPlaylist();
let lobbyService: MasterLobbyService;

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Before the routes: middleware added after them never runs for their paths.
app.set("trust proxy", TRUSTED_PROXY_HOPS);
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

app.use(express.json({ limit: "64kb" }));

registerAuthRoutes(app);
registerUsernameRoutes(app);
registerStatsRoutes(app);
registerClusterListRoute(app);
registerFriendsRoutes(app);
registerServedConfigRoutes(app);
registerShopRoutes(app);
registerSitemapRoutes(app, { log });
// Before the static handler, which would answer `/maps/<map>` from the map
// asset folders.
registerSeoPages(app, { log });
// Before the static handler and the SPA fallback: the bare `/player/<id>`
// link gets the player's head tags here.
registerPlayerProfileRoute({ app, log, baseDir: __dirname });

// Serve the shared app shell for the root document.
app.use(async (req, res, next) => {
  if (req.path === "/") {
    try {
      await sendShellPage(
        res,
        path.join(__dirname, "../../static/index.html"),
        req.path,
      );
    } catch (error) {
      log.error("Error rendering index.html:", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    next();
  }
});

app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res) => {
      applyStaticAssetCacheControl(
        res.setHeader.bind(res),
        res.req.originalUrl,
      );
    },
  }),
);

// Start the master process
export async function startMaster() {
  if (!cluster.isPrimary) {
    throw new Error(
      "startMaster() should only be called in the primary process",
    );
  }

  log.info(`Primary ${process.pid} is running`);

  // Bring the database schema up to date before any worker can read it. The
  // runner takes a lock, so servers that start together do not race.
  if (process.env.SKIP_MIGRATIONS !== "true") {
    await runMigrations(databaseUrl());
    log.info("Database migrations are up to date");
  }
  log.info(`Setting up ${ServerEnv.numWorkers()} workers...`);

  // A server that registers schedules nothing until the API calls it open: a
  // mistyped letter must not mint lobbies under a letter routed elsewhere.
  const registers = clusterCheckinEnabled() && checkinBody(0) !== null;
  lobbyService = new MasterLobbyService(playlist, log, registers);
  // The ranked queues (/matchmaking/join).
  startMatchmaking(server, lobbyService);

  const INSTANCE_ID =
    ServerEnv.env() === GameEnv.Dev
      ? "DEV_ID"
      : crypto.randomBytes(4).toString("hex");
  process.env.INSTANCE_ID = INSTANCE_ID;

  log.info(`Instance ID: ${INSTANCE_ID}`);

  // Join the site's shared public-lobby roster (LobbyCoordinatorClient.ts)
  // when LOBBY_COORDINATOR=api and this server has a public host to
  // register under, the same test as the check-in below. Started before the
  // workers fork so the first roster normally lands before scheduling
  // begins; until it does, and whenever it stops, the master schedules its
  // own lobbies exactly as it does without a coordinator.
  const hello = checkinBody(0);
  const coordinator = coordinatorUrl(registeredSite());
  if (coordinator !== null && hello !== null) {
    log.info(`Joining lobby coordinator at ${coordinator}`);
    const client = new LobbyCoordinatorClient({
      url: coordinator,
      apiKey: ServerEnv.apiKey(),
      hello: {
        letter: hello.letter,
        host: hello.host,
        version: hello.version,
        numWorkers: hello.numWorkers,
        instanceId: INSTANCE_ID,
      },
      handlers: lobbyService.coordinatorHandlers(),
      log,
    });
    lobbyService.attachCoordinator(client);
    client.start();
  }

  // Fork workers
  for (let i = 0; i < ServerEnv.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(i, worker);
    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (workerId === undefined) {
      log.error(`worker crashed could not find id`);
      return;
    }

    const workerIdNum = parseInt(workerId);
    lobbyService.removeWorker(workerIdNum);

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    log.info(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(workerIdNum, newWorker);
    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const PORT = ServerEnv.masterPort();
  server.listen(PORT, () => {
    log.info(`Master HTTP server listening on port ${PORT}`);
  });

  // Register with the API and keep checking in (docs/MultiServer.md,
  // "Server list v2"): the API's list is what clients read to find a
  // server, so a server that isn't checking in isn't offered to anyone.
  // Local development (`npm run dev`, no SUBDOMAIN) has no public host and
  // registers nowhere; every deployed host registers under its own site.
  if (registers) {
    log.info(
      `Checking in with ${ServerEnv.jwtIssuer()}/cluster/checkin every ${CHECKIN_INTERVAL_MS / 1000}s`,
    );
    let lastRefusal: string | null = null;
    startPolling(async () => {
      const body = checkinBody(lobbyService.liveGames());
      if (body === null) return;
      const result = await sendCheckin(body);
      if (isRefusal(result)) {
        if (result.refused !== lastRefusal) {
          log.error(
            `API refused check-in as letter ${body.letter} from ${body.host}: ${result.refused}. Scheduling no public lobbies until it is accepted.`,
          );
        }
        lastRefusal = result.refused;
      } else if (result !== null) {
        lastRefusal = null;
      }
      applyCheckinState(result, (active) => lobbyService.setActive(active));
    }, CHECKIN_INTERVAL_MS);

    // Public-lobby rotation weight overrides set in the API. Until the first
    // fetch lands, and while it keeps failing, the last known weights (or the
    // build's info.json) stay in effect.
    startPolling(async () => {
      playlist.setWeightOverrides(await fetchMapWeights());
    }, MAP_WEIGHTS_POLL_MS);
  }
}

app.get("/api/health", (_req, res) => {
  const ready = lobbyService?.isHealthy() ?? false;
  // instanceId is diagnostics: it tells the machines behind an apex apart.
  const instanceId = ServerEnv.instanceId();
  if (ready) {
    res.json({ status: "ok", instanceId });
  } else {
    res.status(503).json({ status: "unavailable", instanceId });
  }
});

// For infra/vm/deploy.sh, which waits for 0 before it restarts the server.
// It calls the master directly from inside the container. nginx sets
// X-Forwarded-For on every request it proxies, so public requests get a 404.
app.get("/api/running_games", (req, res) => {
  if (req.headers["x-forwarded-for"] !== undefined) {
    res.status(404).end();
    return;
  }
  res.json({ running: lobbyService?.runningGames() ?? 0 });
});

// SPA fallback route
app.get("/{*splat}", async function (req, res) {
  try {
    const htmlPath = path.join(__dirname, "../../static/index.html");
    if (await sendShellPage(res, htmlPath, req.path)) return;
    await renderAppShell(res, htmlPath);
  } catch (error) {
    log.error("Error rendering SPA fallback:", error);
    res.status(500).send("Internal Server Error");
  }
});
