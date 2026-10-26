import type { Express } from "express";
import { z } from "zod";
import { type Authed, requireUser } from "../auth/middleware";
import { requireSameOrigin } from "../auth/routes";
import { db } from "../db";
import { logger } from "../Logger";
import { buildCatalog, findOffer } from "./catalog";
import { purchase } from "./wallet";

const log = logger.child({ comp: "shop" });

const PurchaseSchema = z.object({
  cosmeticType: z.string().max(32),
  cosmeticName: z.string().max(64),
  currencyType: z.string().max(16),
  colorPaletteName: z.string().max(64).optional(),
});

// The catalog is built once: it never changes while the server runs.
let catalog: ReturnType<typeof buildCatalog> | null = null;

export function registerShopRoutes(app: Express): void {
  app.get("/api/cosmetics.json", (_req, res) => {
    catalog ??= buildCatalog();
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(catalog);
  });

  // Buy one cosmetic with soft currency. Any refusal charges nothing.
  app.post(
    "/api/shop/purchase",
    requireSameOrigin,
    requireUser,
    async (req, res) => {
      const body = PurchaseSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ reason: "Invalid request" });
        return;
      }
      const { cosmeticType, cosmeticName, currencyType, colorPaletteName } =
        body.data;
      // Kleopolis has one currency.
      if (currencyType !== "soft") {
        res.status(400).json({ reason: "Currency not accepted" });
        return;
      }
      const offer = findOffer(cosmeticType, cosmeticName, colorPaletteName);
      if (offer === null) {
        res.status(400).json({ reason: "Not for sale" });
        return;
      }
      try {
        const result = await purchase(db().db, (req as Authed).user.id, offer);
        if (result.status === "already_owned") {
          res.status(409).json({ error: "Already owned" });
        } else if (result.status === "insufficient") {
          res.status(400).json({ reason: "Insufficient balance" });
        } else {
          res.json({ ok: true, currency: { soft: result.balance, hard: 0 } });
        }
      } catch (error) {
        log.error("purchase failed", { error: String(error) });
        res.status(500).json({ error: "internal_error" });
      }
    },
  );
}
