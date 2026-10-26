import type { Db } from "@kleopolis/db/client";
import { ownedCosmetics, wallets } from "@kleopolis/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { isUniqueViolation } from "../dbErrors";
import { type Offer, STARTING_SOFT } from "./catalog";

type Tx = Pick<Db, "select" | "insert" | "update">;

// Coins for finishing a game. Only a game with at least two accounts in it pays
// out, and only one that lasted a minute, so a lone player cannot farm bots.
export const MIN_PAID_GAME_MS = 60_000;
export const COINS_PER_GAME = 50;
export const COINS_PER_WIN = 100;

export function coinsEarned(
  won: boolean,
  accountsInGame: number,
  durationMs: number,
): number {
  if (accountsInGame < 2 || durationMs < MIN_PAID_GAME_MS) return 0;
  return COINS_PER_GAME + (won ? COINS_PER_WIN : 0);
}

// Makes the wallet on first use, with the starting grant.
async function ensureWallet(tx: Tx, userId: string): Promise<void> {
  await tx
    .insert(wallets)
    .values({ userId, soft: STARTING_SOFT })
    .onConflictDoNothing();
}

export async function balanceOf(db: Db, userId: string): Promise<number> {
  await ensureWallet(db, userId);
  const rows = await db
    .select({ soft: wallets.soft })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return rows[0]?.soft ?? 0;
}

export async function ownedFlares(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ flare: ownedCosmetics.flare })
    .from(ownedCosmetics)
    .where(eq(ownedCosmetics.userId, userId));
  return rows.map((r) => r.flare).sort();
}

export async function owns(
  db: Db,
  userId: string,
  flare: string,
): Promise<boolean> {
  const rows = await db
    .select({ flare: ownedCosmetics.flare })
    .from(ownedCosmetics)
    .where(
      and(eq(ownedCosmetics.userId, userId), eq(ownedCosmetics.flare, flare)),
    )
    .limit(1);
  return rows.length > 0;
}

// Pays an account. Called inside the transaction that stores a finished game.
export async function award(
  tx: Tx,
  userId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await tx
    .insert(wallets)
    .values({ userId, soft: STARTING_SOFT + amount })
    .onConflictDoUpdate({
      target: wallets.userId,
      set: {
        soft: sql`${wallets.soft} + ${amount}`,
        updatedAt: sql`now()`,
      },
    });
}

export type PurchaseResult =
  | { status: "ok"; balance: number }
  | { status: "insufficient"; balance: number }
  | { status: "already_owned" };

// Buys an offer with soft currency. The wallet row is locked, so two purchases
// at once cannot spend the same coins. Nothing is charged on a refusal.
export async function purchase(
  db: Db,
  userId: string,
  offer: Offer,
): Promise<PurchaseResult> {
  try {
    return await db.transaction(async (tx) => {
      await ensureWallet(tx, userId);
      const [wallet] = await tx
        .select({ soft: wallets.soft })
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update");
      const balance = wallet?.soft ?? 0;
      const held = await tx
        .select({ flare: ownedCosmetics.flare })
        .from(ownedCosmetics)
        .where(
          and(
            eq(ownedCosmetics.userId, userId),
            eq(ownedCosmetics.flare, offer.flare),
          ),
        );
      if (held.length > 0) return { status: "already_owned" } as const;
      if (balance < offer.priceSoft) {
        return { status: "insufficient", balance } as const;
      }
      const left = balance - offer.priceSoft;
      await tx
        .update(wallets)
        .set({ soft: left, updatedAt: sql`now()` })
        .where(eq(wallets.userId, userId));
      await tx.insert(ownedCosmetics).values({
        userId,
        flare: offer.flare,
        pricePaid: offer.priceSoft,
      });
      return { status: "ok", balance: left } as const;
    });
  } catch (error) {
    // The same item bought twice at once: the second insert hits the key.
    if (isUniqueViolation(error)) return { status: "already_owned" };
    throw error;
  }
}
