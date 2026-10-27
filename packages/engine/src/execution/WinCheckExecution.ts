import {
  ColoredTeams,
  GameMode,
  isRankedTeamType,
  PlayerType,
  RankedType,
  Team,
} from "@openfront/engine-api/game/GameTypes";
import { z } from "zod";
import { Execution, Game } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";

export class WinCheckExecution implements Execution {
  private active = true;

  private mg: Game | null = null;

  // Hard time limit (in seconds) to force a winner before the server's
  // maxGameDuration hard kill. 170mins (10 mins before 3hrs)
  private static readonly HARD_TIME_LIMIT_SECONDS = 170 * 60;

  constructor() {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) {
      return;
    }
    if (this.mg === null) throw new Error("Not initialized");

    if (this.mg.config().gameConfig().gameMode === GameMode.FFA) {
      this.checkWinnerFFA();
    } else {
      this.checkWinnerTeam();
    }
  }

  checkWinnerFFA(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const sorted = this.mg
      .players()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    if (sorted.length === 0) {
      return;
    }

    // Ranked 1v1 and FFA end when one connected human is left: everyone else
    // is dead or gone.
    const rankedType = this.mg.config().gameConfig().rankedType;
    if (
      rankedType === RankedType.OneVOne ||
      rankedType === RankedType.FreeForAll
    ) {
      const humans = sorted.filter(
        (p) => p.type() === PlayerType.Human && !p.isDisconnected(),
      );
      if (humans.length === 1) {
        this.mg.setWinner(humans[0], this.mg.stats().stats());
        console.log(`${humans[0].name()} has won the game`);
        this.active = false;
        return;
      }
    }

    // A tribe or nation can't win a ranked game: the API only rates a winner
    // who was in the match, so the largest human takes the threshold or the
    // timer. Archived ranked 1v1 games had only humans, so they resolve the
    // same way.
    const contenders =
      rankedType === RankedType.OneVOne || rankedType === RankedType.FreeForAll
        ? sorted.filter((p) => p.type() === PlayerType.Human)
        : sorted;
    const max = contenders[0];
    if (max === undefined) {
      return;
    }
    if (this.hasWon(max.numTilesOwned())) {
      this.mg.setWinner(max, this.mg.stats().stats());
      console.log(`${max.name()} has won the game`);
      this.active = false;
    }
  }

  // Hold more than the required share of non-fallout land, or outlast the
  // lobby timer / hard limit.
  private hasWon(tilesOwned: number): boolean {
    if (this.mg === null) throw new Error("Not initialized");
    const timeElapsed = this.mg.elapsedGameSeconds();
    // null (host lobby, timer off) means no timer, same as undefined.
    const maxTimerValue = this.mg.config().gameConfig().maxTimerValue;
    if (
      maxTimerValue !== undefined &&
      maxTimerValue !== null &&
      timeElapsed >= maxTimerValue * 60
    ) {
      return true;
    }
    if (timeElapsed >= WinCheckExecution.HARD_TIME_LIMIT_SECONDS) {
      return true;
    }
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    // Cross-multiplied: the threshold is a whole percentage, so this is
    // exact integer math.
    return (
      tilesOwned * 100 >
      numTilesWithoutFallout *
        this.mg.config().percentageTilesOwnedToWin(timeElapsed)
    );
  }

  checkWinnerTeam(): void {
    if (this.mg === null) throw new Error("Not initialized");

    // Ranked team games end when one side has the only connected humans:
    // every player on the other side is dead or gone.
    if (isRankedTeamType(this.mg.config().gameConfig().rankedType)) {
      const standing = new Set<Team>();
      for (const p of this.mg.players()) {
        const team = p.team();
        if (
          team !== null &&
          p.type() === PlayerType.Human &&
          !p.isDisconnected()
        ) {
          standing.add(team);
        }
      }
      if (standing.size === 1) {
        const [team] = standing;
        this.mg.setWinner(team!, this.mg.stats().stats());
        console.log(`${team} has won the game`);
        this.active = false;
        return;
      }
    }

    // The tribes can't win a ranked team game, so a human side takes the
    // timer even when the tribes hold more land.
    const ranked = isRankedTeamType(this.mg.config().gameConfig().rankedType);
    const teamToTiles = new Map<Team, number>();
    for (const player of this.mg.players()) {
      const team = player.team();
      // Sanity check, team should not be null here
      if (team === null) continue;
      if (ranked && team === ColoredTeams.Bot) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
    }
    const sorted = Array.from(teamToTiles.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    if (sorted.length === 0) {
      return;
    }
    const max = sorted[0];
    if (this.hasWon(max[1])) {
      if (max[0] === ColoredTeams.Bot) return;
      this.mg.setWinner(max[0], this.mg.stats().stats());
      console.log(`${max[0]} has won the game`);
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(): ExecRecord {
    return WinCheckExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
    });
  }

  restoreSnapshot(s: WinCheckState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
  }
}

const WinCheckStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
});
type WinCheckState = z.infer<typeof WinCheckStateSchema>;

export const WinCheckExecutionSnapshot = execSnapshotType({
  name: "WinCheck",
  version: 1,
  schema: WinCheckStateSchema,
  cls: () => WinCheckExecution,
});
