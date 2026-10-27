import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  TerraNullius,
  TrajectoryTile,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { NukeType } from "@openfront/engine-api/StatsSchemas";
import { listNukeBreakAlliance } from "@openfront/engine-lib/execution/NukeAlliance";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, isUnit, Player, Unit } from "../game/Game";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { UnitTypeSchema } from "../snapshot/CommonSchemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  ParabolaSchema,
  parabolaState,
  restoreParabola,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { applyBlast, blastTiles } from "./NukeBlast";

export class NukeExecution implements Execution {
  private active = true;
  private mg: Game;
  private nuke: Unit | null = null;
  private tilesToDestroyCache: Set<TileRef> | undefined;
  private pathFinder: ParabolaUniversalPathFinder;

  constructor(
    private nukeType: NukeType,
    private player: Player,
    private dst: TileRef,
    private src?: TileRef | null,
    private speed: number = -1,
    private waitTicks = 0,
    private rocketDirectionUp: boolean = true,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.speed === -1) {
      this.speed = this.mg.config().nukeSpeed(this.nukeType);
    }
    this.pathFinder = UniversalPathFinding.Parabola(mg, {
      increment: this.speed,
      directionUp: this.rocketDirectionUp,
    });
  }

  public target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  private tilesToDestroy(): Set<TileRef> {
    if (this.tilesToDestroyCache !== undefined) {
      return this.tilesToDestroyCache;
    }
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    this.tilesToDestroyCache = blastTiles(
      this.mg,
      this.dst,
      this.mg.config().nukeMagnitudes(this.nuke.type()),
      new PseudoRandom(this.mg.ticks()),
    );
    return this.tilesToDestroyCache;
  }

  /**
   * Break alliances with players significantly affected by the nuke strike.
   * Uses weighted tile counting (inner=1, outer=0.5) OR if any allied structure would be destroyed.
   */
  private maybeBreakAlliances() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    if (this.nuke.type() === UnitType.MIRVWarhead) {
      // MIRV warheads shouldn't break alliances
      return;
    }

    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());

    const playersToBreakAllianceWith = listNukeBreakAlliance({
      game: this.mg,
      targetTile: this.dst,
      magnitude,
      threshold: this.mg.config().nukeAllianceBreakThreshold(),
    });

    // Automatically reject incoming alliance requests.
    for (const incoming of this.player.incomingAllianceRequests()) {
      if (playersToBreakAllianceWith.has(incoming.requestor().smallID())) {
        incoming.reject();
      }
    }

    for (const playerSmallId of playersToBreakAllianceWith) {
      const attackedPlayer = this.mg.playerBySmallID(playerSmallId);
      if (!attackedPlayer.isPlayer()) {
        continue;
      }

      // Resolves exploit of alliance breaking in which a pending alliance request
      // was accepted in the middle of a missile attack.
      const outgoingAllianceRequest = attackedPlayer
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === this.player);
      if (outgoingAllianceRequest) {
        outgoingAllianceRequest.reject();
        continue;
      }

      const alliance = this.player.allianceWith(attackedPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (attackedPlayer !== this.player) {
        attackedPlayer.updateRelation(this.player, -100);
      }
    }
  }

  tick(ticks: number): void {
    if (this.nuke === null) {
      const spawn = this.player.canBuild(this.nukeType, this.dst);
      if (spawn === false) {
        console.warn(`cannot build Nuke`);
        this.active = false;
        return;
      }
      // The launch tile can be overridden by the caller (e.g. MIRV warheads
      // launch from the MIRV separation point, not a silo).
      this.src ??= spawn;
      const silo = this.player
        .units(UnitType.MissileSilo)
        .find((silo) => silo.tile() === spawn);
      // Stacked purchases launch several nukes across ticks; delay each missile
      // so launches from the same silo trail each other instead of overlapping.
      // The silo remembers the last departure it handed out, because its timer
      // queue drops entries as slots reload and cannot be used for this.
      if (silo !== undefined) {
        this.waitTicks += silo.reserveNukeDeparture() - this.mg.ticks();
      }
      this.nuke = this.player.buildUnit(this.nukeType, this.src, {
        targetTile: this.dst,
        trajectory: this.getTrajectory(this.dst),
      });
      this.nuke.updateNukeState({ waitTicks: this.waitTicks });
      this.recordMotionPlan(ticks);
      if (this.nuke.type() !== UnitType.MIRVWarhead) {
        this.maybeBreakAlliances();
      }
      if (this.mg.hasOwner(this.dst)) {
        const target = this.mg.owner(this.dst);
        if (!target.isPlayer()) {
          // Ignore terra nullius
        } else if (this.nukeType === UnitType.AtomBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            "events_display.atom_bomb_inbound",
            MessageType.NUKE_INBOUND,
            target.id(),
          );
        } else if (this.nukeType === UnitType.HydrogenBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            "events_display.hydrogen_bomb_inbound",
            MessageType.HYDROGEN_BOMB_INBOUND,
            target.id(),
          );
        }

        if (this.nukeType === UnitType.MIRV) {
          this.mg.recordMirvLaunch();
        }
        // Record stats
        this.mg.stats().bombLaunch(this.player, target, this.nukeType);
      }

      // after sending a nuke set the missilesilo on cooldown
      if (silo) {
        silo.launch();
      }
      return;
    }

    // make the nuke unactive if it was intercepted
    if (!this.nuke.isActive()) {
      this.active = false;
      return;
    }

    if (this.waitTicks > 0) {
      this.nuke.updateNukeState({ waitTicks: --this.waitTicks });
      return;
    }

    // Move to next tile
    const result = this.pathFinder.next(this.src!, this.dst, this.speed);

    if (result.status === PathStatus.COMPLETE) {
      // move it afterward for visual effect
      this.nuke.move(result.node);

      // Check for very close SAM missiles that are targeting this.
      // The SAM logic should be the main source of truth, since missiles can skip pixels
      // and be affected by execution order
      const shouldBeDestroyed =
        this.mg.nearbyUnits(
          this.dst,
          this.mg.config().defaultSamMissileSpeed(),
          UnitType.SAMMissile,
          ({ unit }) => {
            if (!isUnit(unit) || unit.owner() === this.nuke?.owner())
              return false;
            return unit.targetUnit()?.id() === this.nuke?.id();
          },
        ).length >= 1;
      if (!shouldBeDestroyed) this.detonate();
    } else if (result.status === PathStatus.NEXT) {
      this.updateNukeTargetable();
      this.nuke.move(result.node);
      // Update index so SAM can interpolate future position
      this.nuke.setTrajectoryIndex(this.pathFinder.currentIndex());
    }
  }

  public getNuke(): Unit | null {
    return this.nuke;
  }

  /**
   * Record a motion plan so the client can derive the nuke's position each
   * tick instead of receiving per-tick unit updates (see TradeShipExecution).
   * Replays a separate pathfinder because the curve's cached points don't
   * advance exactly one index per tick — the plan path must be the exact
   * tile sequence that movement's `next()` calls will produce.
   */
  private recordMotionPlan(ticks: number): void {
    if (this.nuke === null || this.src === undefined || this.src === null) {
      return;
    }
    const pathFinder = UniversalPathFinding.Parabola(this.mg, {
      increment: this.speed,
      directionUp: this.rocketDirectionUp,
    });
    const path: TileRef[] = [this.src];
    let result = pathFinder.next(this.src, this.dst, this.speed);
    while (result.status === PathStatus.NEXT) {
      path.push(result.node);
      result = pathFinder.next(this.src, this.dst, this.speed);
    }
    this.mg.recordMotionPlan({
      kind: "grid",
      unitId: this.nuke.id(),
      planId: 1,
      startTick: ticks + this.waitTicks + 1,
      ticksPerStep: 1,
      path,
    });
  }

  private getTrajectory(target: TileRef): TrajectoryTile[] {
    const trajectoryTiles: TrajectoryTile[] = [];
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const allTiles = this.pathFinder.findPath(this.src!, target) ?? [];
    for (const tile of allTiles) {
      trajectoryTiles.push({
        tile,
        targetable: this.isTargetable(target, tile, targetRangeSquared),
      });
    }

    return trajectoryTiles;
  }

  private isTargetable(
    targetTile: TileRef,
    nukeTile: TileRef,
    targetRangeSquared: number,
  ): boolean {
    return (
      this.mg.euclideanDistSquared(nukeTile, targetTile) < targetRangeSquared ||
      (this.src !== undefined &&
        this.src !== null &&
        this.mg.euclideanDistSquared(this.src, nukeTile) < targetRangeSquared)
    );
  }

  private updateNukeTargetable() {
    if (this.nuke === null || this.nuke.targetTile() === undefined) {
      return;
    }
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const targetTile = this.nuke.targetTile();
    this.nuke.setTargetable(
      this.isTargetable(targetTile!, this.nuke.tile(), targetRangeSquared),
    );
  }

  private detonate() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }

    const mg = this.mg;
    const magnitude = mg.config().nukeMagnitudes(this.nuke.type());
    const tilesPerPlayers = applyBlast(
      mg,
      this.dst,
      this.tilesToDestroy(),
      this.nukeType,
      magnitude.outer,
      this.player,
    );

    this.active = false;
    this.nuke.setReachedTarget();
    this.nuke.delete(false);

    if (
      this.nukeType === UnitType.AtomBomb ||
      this.nukeType === UnitType.HydrogenBomb
    ) {
      const messageKey =
        this.nukeType === UnitType.AtomBomb
          ? "events_display.atom_bomb_detonated"
          : "events_display.hydrogen_bomb_detonated";
      for (const [impactedPlayer] of tilesPerPlayers) {
        mg.displayMessage(
          messageKey,
          MessageType.NUKE_DETONATED,
          impactedPlayer.id(),
          undefined,
          { name: this.player.displayName() },
          undefined,
          this.player.id(),
        );
      }
    }

    // Record stats
    this.mg
      .stats()
      .bombLand(this.player, this.target(), this.nuke.type() as NukeType);
  }

  cancel(): void {
    this.active = false;
    if (this.nuke !== null && this.nuke.isActive()) {
      this.nuke.delete(false);
    }
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  // tilesToDestroyCache is not stored: it is filled and read within the
  // detonation tick, after which the execution is inactive.
  snapshot(w: SnapshotWriter): ExecRecord {
    return NukeExecutionSnapshot.write({
      active: this.active,
      // mg and the pathfinder are both set by init.
      pathFinder: this.mg === undefined ? null : parabolaState(this.pathFinder),
      nuke: w.unitOrNull(this.nuke),
      nukeType: this.nukeType,
      player: w.player(this.player),
      dst: this.dst,
      src: this.src,
      speed: this.speed,
      waitTicks: this.waitTicks,
      rocketDirectionUp: this.rocketDirectionUp,
    });
  }

  restoreSnapshot(s: NukeState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.pathFinder !== null) {
      this.mg = r.game;
      this.pathFinder = restoreParabola(r.game, s.pathFinder);
    }
    this.nuke = r.unitOrNull(s.nuke);
    this.nukeType = s.nukeType as NukeType;
    this.player = r.player(s.player);
    this.dst = s.dst;
    this.src = s.src;
    this.speed = s.speed;
    this.waitTicks = s.waitTicks;
    this.rocketDirectionUp = s.rocketDirectionUp;
  }
}

const NukeStateSchema = z.object({
  active: z.boolean(),
  pathFinder: ParabolaSchema.nullable(),
  nuke: zRef().nullable(),
  nukeType: UnitTypeSchema,
  player: zPlayerRef(),
  dst: zTile(),
  // undefined and null both mean "launch from a silo"; kept apart as given.
  src: zTile().nullable().optional(),
  speed: zNum(),
  waitTicks: zInt(),
  rocketDirectionUp: z.boolean(),
});
type NukeState = z.infer<typeof NukeStateSchema>;

export const NukeExecutionSnapshot = execSnapshotType({
  name: "Nuke",
  version: 1,
  schema: NukeStateSchema,
  cls: () => NukeExecution,
});
