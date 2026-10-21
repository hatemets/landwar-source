import { describe, expect, it } from "vitest";
import {
  COINS_PER_GAME,
  COINS_PER_WIN,
  coinsEarned,
  MIN_PAID_GAME_MS,
} from "../../../src/server/shop/wallet";

describe("coinsEarned", () => {
  it("pays for a finished game, more for a win", () => {
    expect(coinsEarned(false, 2, MIN_PAID_GAME_MS)).toBe(COINS_PER_GAME);
    expect(coinsEarned(true, 2, MIN_PAID_GAME_MS)).toBe(
      COINS_PER_GAME + COINS_PER_WIN,
    );
  });

  it("pays nothing to a lone account", () => {
    expect(coinsEarned(true, 1, MIN_PAID_GAME_MS * 10)).toBe(0);
  });

  it("pays nothing for a game under a minute", () => {
    expect(coinsEarned(true, 4, MIN_PAID_GAME_MS - 1)).toBe(0);
  });
});
