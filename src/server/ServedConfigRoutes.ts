import type { Express } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const resourcesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../resources",
);

// The small JSON configs the client reads from its API host in OpenFront.
// Kleopolis serves them itself: the stream list from the files in
// resources/, and an empty identity list, because Kleopolis links no outside
// identity. The cosmetics catalog is in shop/routes.ts.
export function registerServedConfigRoutes(app: Express): void {
  const file = (name: string) => async (_req: unknown, res: any) => {
    try {
      const body = await fs.readFile(path.join(resourcesDir, name), "utf8");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.type("json").send(body);
    } catch {
      res.status(404).json({ error: "not_found" });
    }
  };
  app.get("/api/streams.json", file("streams.json"));
  app.get("/api/public/identity_token/audiences", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ audiences: [] });
  });
}
