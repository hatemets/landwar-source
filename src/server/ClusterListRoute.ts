import { isCommitLike } from "@openfront/shared/ServerList";
import type { Express } from "express";
import { ServerEnv } from "./ServerEnv";

// The server list the client reads before it allows multiplayer. Kleopolis has
// one deployment and no cluster API, so this server lists itself. A build
// without a commit sha (dev) lists nothing; the client then uses its own
// values and still counts the server as reachable.
export function registerClusterListRoute(app: Express): void {
  app.get("/api/cluster.json", (req, res) => {
    const version = process.env.GIT_COMMIT ?? "";
    res.setHeader("Cache-Control", "public, max-age=5");
    if (!isCommitLike(version)) {
      res.json({ servers: {} });
      return;
    }
    res.json({
      latest: version,
      servers: {
        [ServerEnv.instanceLetter()]: {
          host: req.get("host") ?? ServerEnv.publicHost() ?? "localhost",
          numWorkers: ServerEnv.numWorkers(),
          version,
          state: "open",
        },
      },
    });
  });
}
