import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { NukeType } from "@openfront/engine-api/StatsSchemas";
import { NukeMagnitude } from "@openfront/engine-lib/configuration/Config";
import { atan2 } from "@openfront/engine-lib/DetMath";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { zPlayerRef, zTile } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

const SPRITE_RADIUS = 16;

// Units a blast passes over without harm.
const BLAST_PROOF_TYPES: ReadonlySet<UnitType> = new Set([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRVWarhead,
  UnitType.MIRV,
  UnitType.SAMMissile,
]);

/** The tiles a blast of this magnitude at `center` destroys. */
export function blastTiles(
  mg: Game,
  center: TileRef,
  magnitude: NukeMagnitude,
  rand: PseudoRandom,
): Set<TileRef> {
  const inner2 = magnitude.inner * magnitude.inner;
  const outer2 = magnitude.outer * magnitude.outer;

  if (!mg.config().waterNukes()) {
    return mg.bfs(center, (_, n: TileRef) => {
      const d2 = mg.euclideanDistSquared(center, n);
      return (
        d2 <= outer2 && (d2 <= inner2 || rand.chance(2)) && !mg.isImpassable(n)
      );
    });
  }

  // Smooth irregular boundary for water nukes.
  // Generate random radii at angular samples, then smooth them so the
  // boundary undulates gently instead of creating spiky flower shapes.
  // This avoids scattered land pixels that players would have to boat
  // to individually in order to reclaim.
  const NUM_SAMPLES = 16;
  const radiiSq: number[] = new Array(NUM_SAMPLES);
  for (let i = 0; i < NUM_SAMPLES; i++) {
    radiiSq[i] = rand.nextFloat(inner2, outer2);
  }
  // Smooth the ring: 1 light pass (60% original, 20% each neighbour)
  const prev = [...radiiSq];
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const l = (i - 1 + NUM_SAMPLES) % NUM_SAMPLES;
    const r = (i + 1) % NUM_SAMPLES;
    radiiSq[i] = prev[i] * 0.6 + prev[l] * 0.2 + prev[r] * 0.2;
  }

  const cx = mg.x(center);
  const cy = mg.y(center);
  const outer = magnitude.outer;

  const result = new Set<TileRef>();
  const x0 = Math.max(0, cx - outer);
  const y0 = Math.max(0, cy - outer);
  const x1 = Math.min(mg.width() - 1, cx + outer);
  const y1 = Math.min(mg.height() - 1, cy + outer);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx;
      const dy = py - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > outer2) continue;
      if (d2 > inner2) {
        const angle = atan2(dy, dx) + Math.PI; // [0, 2π]
        const t = (angle / (2 * Math.PI)) * NUM_SAMPLES;
        const i0 = Math.floor(t) % NUM_SAMPLES;
        const i1 = (i0 + 1) % NUM_SAMPLES;
        const frac = t - Math.floor(t);
        const threshold = radiiSq[i0] * (1 - frac) + radiiSq[i1] * frac;
        if (d2 > threshold) continue;
      }
      const tile = mg.ref(px, py);
      if (mg.isImpassable(tile)) continue;
      result.add(tile);
    }
  }
  return result;
}

/**
 * Applies a blast at `center`: frees the tiles, kills troops as `deathType`
 * would, and destroys every unit within `outer`. A finished reactor in range
 * melts down in turn. `attacker` is credited with the kills; null credits
 * nobody. Returns the tiles each player lost.
 */
export function applyBlast(
  mg: Game,
  center: TileRef,
  tiles: Set<TileRef>,
  deathType: NukeType,
  outer: number,
  attacker: Player | null,
): Map<Player, number> {
  const config = mg.config();

  // Retrieve all impacted players and the number of tiles
  const tilesPerPlayers = new Map<Player, number>();
  for (const tile of tiles) {
    const owner = mg.owner(tile);
    if (owner.isPlayer()) {
      owner.relinquish(tile);
      tilesPerPlayers.set(owner, (tilesPerPlayers.get(owner) ?? 0) + 1);
    }

    // Queue land tiles for batched water conversion
    if (mg.isLand(tile)) {
      mg.queueWaterConversion(tile);
    }

    // Record every tile in the blast radius for nukeable layer destruction.
    mg.queueNukeImpact(tile);
  }

  // Then compute the explosion effect on each player
  for (const [player, numImpactedTiles] of tilesPerPlayers) {
    const tilesBeforeNuke = player.numTilesOwned() + numImpactedTiles;
    const transportShips = player.units(UnitType.TransportShip);
    const transportShipTroops = new Map<Unit, number>();
    for (const unit of transportShips) {
      transportShipTroops.set(unit, unit.troops());
    }
    const outgoingAttacks = player.outgoingAttacks();
    const maxTroops = config.maxTroops(player);
    // nukeDeathFactor could compute the complete fallout in a single call instead
    for (let i = 0; i < numImpactedTiles; i++) {
      // Diminishing effect as each affected tile has been nuked
      const numTilesLeft = tilesBeforeNuke - i;
      player.removeTroops(
        config.nukeDeathFactor(
          deathType,
          player.troops(),
          numTilesLeft,
          maxTroops,
        ),
      );
      for (const attack of outgoingAttacks) {
        const attackTroops = attack.troops();
        const deaths = config.nukeDeathFactor(
          deathType,
          attackTroops,
          numTilesLeft,
          maxTroops,
        );
        attack.setTroops(attackTroops - deaths);
      }
      for (const unit of transportShips) {
        const unitTroops = transportShipTroops.get(unit) ?? unit.troops();
        const deaths = config.nukeDeathFactor(
          deathType,
          unitTroops,
          numTilesLeft,
          maxTroops,
        );
        transportShipTroops.set(unit, Math.max(0, unitTroops - deaths));
      }
    }
    for (const [unit, troops] of transportShipTroops) {
      unit.setTroops(troops);
    }
  }

  const outer2 = outer * outer;
  for (const unit of mg.units()) {
    if (BLAST_PROOF_TYPES.has(unit.type())) continue;
    if (mg.euclideanDistSquared(center, unit.tile()) >= outer2) continue;
    // treatAFKFriendly matches warship targeting: a disconnected
    // teammate's or ally's units are still not kills.
    const killer =
      attacker === null || attacker.isFriendly(unit.owner(), true)
        ? undefined
        : attacker;
    if (canMeltDown(unit)) {
      meltDown(mg, unit, killer ?? null);
    } else {
      unit.delete(true, killer);
    }
  }

  redrawBuildings(mg, center, outer + SPRITE_RADIUS);
  return tilesPerPlayers;
}

function redrawBuildings(mg: Game, center: TileRef, range: number) {
  const rangeSquared = range * range;
  for (const unit of mg.units()) {
    if (Structures.has(unit.type())) {
      if (mg.euclideanDistSquared(center, unit.tile()) < rangeSquared) {
        unit.touch();
      }
    }
  }
}

/** Whether losing this unit sets off a meltdown: a finished reactor. */
export function canMeltDown(unit: Unit): boolean {
  return unit.type() === UnitType.Reactor && !unit.isUnderConstruction();
}

/**
 * Destroys a reactor and blows it up on the next tick. The dead unit carries
 * reachedTarget, so clients draw a nuke explosion at its tile. `culprit`
 * (the captor or the nuke's owner) is credited with the kills.
 */
export function meltDown(mg: Game, reactor: Unit, culprit: Player | null) {
  const owner = reactor.owner();
  reactor.setReachedTarget();
  reactor.delete(false, culprit ?? undefined);
  mg.addExecution(new MeltdownExecution(reactor.tile(), owner, culprit));
}

export class MeltdownExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private tile: TileRef,
    private owner: Player,
    private culprit: Player | null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    this.active = false;
    const mg = this.mg;
    const magnitude = mg.config().nukeMagnitudes(UnitType.Reactor);
    const tiles = blastTiles(
      mg,
      this.tile,
      magnitude,
      new PseudoRandom(ticks + this.tile),
    );
    const impacted = applyBlast(
      mg,
      this.tile,
      tiles,
      UnitType.AtomBomb,
      magnitude.outer,
      this.culprit,
    );
    const players = new Set(impacted.keys());
    players.add(this.owner);
    for (const player of players) {
      mg.displayMessage(
        "events_display.reactor_meltdown",
        MessageType.NUKE_DETONATED,
        player.id(),
        undefined,
        { name: this.owner.displayName() },
      );
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return MeltdownExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      tile: this.tile,
      owner: w.player(this.owner),
      culprit: w.playerOrNull(this.culprit),
    });
  }

  restoreSnapshot(s: MeltdownState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.tile = s.tile;
    this.owner = r.player(s.owner);
    this.culprit = r.playerOrNull(s.culprit);
  }
}

const MeltdownStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  tile: zTile(),
  owner: zPlayerRef(),
  culprit: zPlayerRef().nullable(),
});
type MeltdownState = z.infer<typeof MeltdownStateSchema>;

export const MeltdownExecutionSnapshot = execSnapshotType({
  name: "Meltdown",
  version: 1,
  schema: MeltdownStateSchema,
  cls: () => MeltdownExecution,
});
