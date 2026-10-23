import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { UnitTypeSchema } from "../snapshot/CommonSchemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

// Spends all of a player's gold on upgrades of the given types in one tick.
// The engine prices every level, so one intent replaces many bulk upgrades.
export class MaxUpgradeExecution implements Execution {
  constructor(
    private player: Player,
    private types: readonly UnitType[],
  ) {}

  init(mg: Game, ticks: number): void {
    this.player.maxUpgradeUnits(this.types);
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return MaxUpgradeExecutionSnapshot.write({
      player: w.player(this.player),
      types: [...this.types],
    });
  }

  restoreSnapshot(s: MaxUpgradeState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.types = s.types;
  }
}

const MaxUpgradeStateSchema = z.object({
  player: zPlayerRef(),
  types: z.array(UnitTypeSchema),
});
type MaxUpgradeState = z.infer<typeof MaxUpgradeStateSchema>;

export const MaxUpgradeExecutionSnapshot = execSnapshotType({
  name: "MaxUpgrade",
  version: 1,
  schema: MaxUpgradeStateSchema,
  cls: () => MaxUpgradeExecution,
});
