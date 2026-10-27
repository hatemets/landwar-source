import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

// Pays the reactor's owner each tick once it is built. The meltdown lives in
// NukeBlast: PlayerExecution and blasts set it off.
export class ReactorExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  constructor(private reactor: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.reactor.isActive()) {
      this.active = false;
      return;
    }
    if (this.reactor.isUnderConstruction()) return;
    const owner = this.reactor.owner();
    const gold = this.mg.config().reactorGoldRate(owner);
    owner.addGold(gold);
    this.mg.stats().goldWork(owner, gold);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ReactorExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      reactor: w.unit(this.reactor),
    });
  }

  restoreSnapshot(s: ReactorState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.reactor = r.unit(s.reactor);
  }
}

const ReactorStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  reactor: zRef(),
});
type ReactorState = z.infer<typeof ReactorStateSchema>;

export const ReactorExecutionSnapshot = execSnapshotType({
  name: "Reactor",
  version: 1,
  schema: ReactorStateSchema,
  cls: () => ReactorExecution,
});
