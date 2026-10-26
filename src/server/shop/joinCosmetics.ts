import type {
  PlayerCosmeticRefs,
  PlayerCosmetics,
} from "@openfront/shared/WireSchemas";
import { db } from "../db";
import { logger } from "../Logger";
import { FLAGS, PALETTES, PATTERNS, flagFlare, patternFlare } from "./catalog";
import { owns } from "./wallet";

const log = logger.child({ comp: "shop" });

export type JoinCosmetics =
  | { ok: true; cosmetics: PlayerCosmetics | undefined }
  // The player named a cosmetic they do not own. The join is refused.
  | { ok: false };

// Checks the cosmetics a player asks to wear, and turns the names into what
// the game renders. A country flag is free. Anything else must be owned. A
// guest owns nothing. Cosmetics Kleopolis does not sell are dropped: the client
// only sends what it holds, and there is nothing to check them against.
export async function resolveJoinCosmetics(
  refs: PlayerCosmeticRefs | undefined,
  userId: string | null,
): Promise<JoinCosmetics> {
  if (refs === undefined) return { ok: true, cosmetics: undefined };
  const cosmetics: PlayerCosmetics = {};

  try {
    if (refs.flag !== undefined && refs.flag !== "") {
      if (refs.flag.startsWith("country:")) {
        cosmetics.flag = refs.flag;
      } else {
        const name = refs.flag.slice("flag:".length);
        const known = FLAGS.some((f) => f.name === name);
        if (!known || userId === null) return { ok: false };
        if (!(await owns(db().db, userId, flagFlare(name)))) {
          return { ok: false };
        }
        cosmetics.flag = refs.flag;
      }
    }

    if (refs.patternName !== undefined) {
      const palette = PALETTES.find(
        (p) => p.name === refs.patternColorPaletteName,
      );
      const pattern = PATTERNS.find((p) => p.name === refs.patternName);
      if (!pattern || !palette || userId === null) return { ok: false };
      if (
        !(await owns(db().db, userId, patternFlare(pattern.name, palette.name)))
      ) {
        return { ok: false };
      }
      cosmetics.pattern = {
        name: pattern.name,
        patternData: pattern.data,
        colorPalette: palette,
      };
    }
  } catch (error) {
    // Cannot tell what they own, so wear nothing rather than refuse the join.
    log.error("could not check cosmetics", { error: String(error) });
    return { ok: true, cosmetics: undefined };
  }

  return {
    ok: true,
    cosmetics: Object.keys(cosmetics).length > 0 ? cosmetics : undefined,
  };
}
