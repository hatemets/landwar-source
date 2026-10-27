import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameStartInfo,
  GameStartInfoSchema,
} from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { createLobbyFillers } from "@openfront/engine/game/NationCreation";
import {
  newPlayerInfo,
  playerInfoData,
} from "@openfront/engine/snapshot/CommonSchemas";
import { describe, expect, test } from "vitest";
import { setup } from "./util/Setup";

function gameStart(fillers?: { username: string }[]): GameStartInfo {
  return {
    gameID: "test1234",
    lobbyCreatedAt: 0,
    config: {
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Public,
      difficulty: Difficulty.Medium,
      nations: "default",
      donateGold: false,
      donateTroops: false,
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    },
    players: [],
    fillers,
  };
}

describe("lobby fillers", () => {
  test("each filler becomes a nation that spawns at random and is marked", () => {
    const nations = createLobbyFillers(
      gameStart([{ username: "jonas07" }, { username: "FrostRaven" }]),
      new PseudoRandom(1),
    );
    expect(nations.map((n) => n.playerInfo.name)).toEqual([
      "jonas07",
      "FrostRaven",
    ]);
    for (const n of nations) {
      expect(n.spawnCell).toBeUndefined();
      expect(n.playerInfo.playerType).toBe(PlayerType.Nation);
      expect(n.playerInfo.isLobbyFill).toBe(true);
      expect(n.playerInfo.clientID).toBeNull();
    }
  });

  test("a game without fillers gets none", () => {
    expect(createLobbyFillers(gameStart(), new PseudoRandom(1))).toEqual([]);
  });

  test("the start info accepts player-style names only", () => {
    expect(
      GameStartInfoSchema.safeParse(gameStart([{ username: "Viktor_wolf" }]))
        .success,
    ).toBe(true);
    expect(
      GameStartInfoSchema.safeParse(gameStart([{ username: "ab" }])).success,
    ).toBe(false);
  });

  test("the mark survives a snapshot", () => {
    const [filler] = createLobbyFillers(
      gameStart([{ username: "TheBaron" }]),
      new PseudoRandom(1),
    );
    expect(newPlayerInfo(playerInfoData(filler!.playerInfo)).isLobbyFill).toBe(
      true,
    );
  });

  test("the player update carries the mark, and plain nations do not", async () => {
    const [filler] = createLobbyFillers(
      gameStart([{ username: "storm312" }]),
      new PseudoRandom(1),
    );
    const game = await setup("plains", {}, [], undefined, undefined, true, [
      filler!,
    ]);
    const player = game.addPlayer(filler!.playerInfo);
    const update = player.toUpdate();
    expect(update?.playerType).toBe(PlayerType.Nation);
    expect(update?.isLobbyFill).toBe(true);

    const [plain] = createLobbyFillers(
      gameStart([{ username: "Nation" }]),
      new PseudoRandom(2),
    );
    const plainInfo = newPlayerInfo({
      ...playerInfoData(plain!.playerInfo),
      isLobbyFill: undefined,
    });
    expect(game.addPlayer(plainInfo).toUpdate()?.isLobbyFill).toBeUndefined();
  });
});
