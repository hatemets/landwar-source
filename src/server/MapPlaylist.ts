import {
  maps as allMaps,
  Difficulty,
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  PublicGameModifiers,
  Quads,
  Trios,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig, TeamCountConfig } from "@openfront/engine-api/Schemas";
import {
  DEFAULT_GOLD_MULTIPLIER,
  SAM_CONSTRUCTION_TICKS,
} from "@openfront/engine-lib/configuration/Config";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { ScheduledPublicGameType } from "@openfront/shared/WireSchemas";
import { logger } from "./Logger";
import { getMapLandTiles } from "./MapLandTiles";
import { calculateMapPlayerCounts } from "./MapPlayerCounts";
import { MapWeightOverrides } from "./MapWeights";

const log = logger.child({});

// Lobby size the Crowded modifier forces on small maps (compact / normal).
const CROWDED_COMPACT_PLAYER_COUNT = 60;
const CROWDED_PLAYER_COUNT = 125;

// Small squads and many teams keep each player's game their own. Two big
// sides (and Humans vs Nations, also two sides) are rare.
const TEAM_WEIGHTS: { config: TeamCountConfig; weight: number }[] = [
  { config: 3, weight: 3 },
  { config: 4, weight: 7 },
  { config: 5, weight: 8 },
  { config: 6, weight: 8 },
  { config: 7, weight: 8 },
  { config: Duos, weight: 25 },
  { config: Trios, weight: 22 },
  { config: Quads, weight: 15 },
  { config: HumansVsNations, weight: 4 },
];

// Maps with a preferred team count in team / special games, declared via
// "special_team_count" in each map's info.json.
// For these maps the preferred team count overrides the random TEAM_WEIGHTS
// roll with SPECIAL_TEAM_FORCE_CHANCE.
const SPECIAL_TEAM_FORCE_CHANCE = 0.25;
const SPECIAL_TEAM_MAPS: ReadonlyMap<GameMapType, TeamCountConfig> = new Map(
  allMaps
    .filter((m) => m.specialTeamCount !== undefined)
    .map((m) => [m.type, m.specialTeamCount!]),
);

type ModifierKey =
  | "isRandomSpawn"
  | "isCompact"
  | "isCrowded"
  | "isHardNations"
  | "startingGold1M"
  | "startingGold5M"
  | "startingGold25M"
  | "goldMultiplier"
  | "isAlliancesDisabled"
  | "isNukesDisabled"
  | "isSAMsDisabled"
  | "isPeaceTime"
  | "isWaterNukes"
  | "isDoomsdayClock";

// Each entry represents one "ticket" in the pool. More tickets = higher chance of selection.
// A rich economy (x6 gold, 5M start) and no missiles are the favourites.
// A 1M start is the default, so it is not in the pool.
const SPECIAL_MODIFIER_POOL: ModifierKey[] = [
  ...Array<ModifierKey>(3).fill("isRandomSpawn"),
  ...Array<ModifierKey>(3).fill("isCompact"),
  // No "isCrowded": it would force 60 or 125 players, and lobbies stay small
  // (LOBBY_SIZES).
  ...Array<ModifierKey>(1).fill("isHardNations"),
  ...Array<ModifierKey>(12).fill("startingGold5M"),
  ...Array<ModifierKey>(3).fill("startingGold25M"),
  ...Array<ModifierKey>(14).fill("goldMultiplier"),
  ...Array<ModifierKey>(1).fill("isAlliancesDisabled"),
  ...Array<ModifierKey>(10).fill("isNukesDisabled"),
  ...Array<ModifierKey>(1).fill("isSAMsDisabled"),
  ...Array<ModifierKey>(1).fill("isPeaceTime"),
  ...Array<ModifierKey>(2).fill("isWaterNukes"),
  ...Array<ModifierKey>(3).fill("isDoomsdayClock"),
];

// The share of special games that are free for all, not teams.
const SPECIAL_FFA_CHANCE = 0.8;

// The ffa and team queues step through these economies in turn. Most games
// are fast: x5 or x10 gold with a 10M or 30M start. The rest keep the
// engine's defaults (x3 gold, 1M start) or start with 5M. Half have no
// missiles.
interface EconomyPreset {
  startingGold?: number;
  goldMultiplier?: number;
  noMissiles?: boolean;
}
export const ECONOMY_ROTATION: readonly EconomyPreset[] = [
  { startingGold: 10_000_000, goldMultiplier: 5, noMissiles: true },
  { startingGold: 5_000_000 },
  { startingGold: 30_000_000, goldMultiplier: 10 },
  { noMissiles: true },
  { startingGold: 10_000_000, goldMultiplier: 10, noMissiles: true },
  { startingGold: 30_000_000, goldMultiplier: 5 },
];

// The "goldMultiplier" modifier doubles the default gold rate.
export const SPECIAL_GOLD_MULTIPLIER = 2 * DEFAULT_GOLD_MULTIPLIER;

// Speeds the Doomsday Clock can roll at when it lands in the rotation. Picked
// per game (see getSpecialConfig) so the pacing varies instead of always being
// the same preset.
const DOOMSDAY_ROTATION_SPEEDS = [
  "slow",
  "normal",
  "fast",
  "veryfast",
] as const;

// Modifiers that cannot be active at the same time.
const MUTUALLY_EXCLUSIVE_MODIFIERS: [ModifierKey, ModifierKey][] = [
  ["startingGold5M", "startingGold25M"],
  ["startingGold5M", "startingGold1M"],
  ["startingGold25M", "startingGold1M"],
  ["isHardNations", "startingGold25M"],
  ["isNukesDisabled", "isSAMsDisabled"],
  ["isNukesDisabled", "isWaterNukes"],
];

// The gold rush queue: big maps with wide land and open sea, a rich start
// and fast income. It alternates two variants, so one of each is usually on
// offer: one with every missile disabled and Medium nations, and one with
// missiles and nations that roll from Medium to Impossible.
export const GOLD_RUSH_MAPS: readonly GameMapType[] = [
  GameMapType.World,
  GameMapType.GiantWorldMap,
  GameMapType.Europe,
  GameMapType.Asia,
  GameMapType.Africa,
  GameMapType.NorthAmerica,
  GameMapType.SouthAmerica,
];
// Prime time is the day's big match, so it is always a large, real-world map
// that a newcomer recognises: no fictional, joke or arcade maps. The ffa,
// team and special queues favour these maps too (REAL_WORLD_MAP_SHARE).
export const PRIME_TIME_MAPS: readonly GameMapType[] = [
  GameMapType.World,
  GameMapType.GiantWorldMap,
  GameMapType.Europe,
  GameMapType.Asia,
  GameMapType.Africa,
  GameMapType.NorthAmerica,
  GameMapType.SouthAmerica,
  GameMapType.UnitedStates,
  GameMapType.Russia,
  GameMapType.MareNostrum,
  GameMapType.Mena,
  GameMapType.IndianSubcontinent,
  GameMapType.EastAsia,
  GameMapType.Scandinavia,
  GameMapType.Britannia,
];
// Gold rush economies. Each runs twice in a row, once without missiles and
// once with them.
export const GOLD_RUSH_ECONOMIES: readonly {
  startingGold: number;
  goldMultiplier: number;
}[] = [
  { startingGold: 10_000_000, goldMultiplier: 5 },
  { startingGold: 30_000_000, goldMultiplier: 10 },
  { startingGold: 30_000_000, goldMultiplier: 5 },
  { startingGold: 10_000_000, goldMultiplier: 10 },
];
// Server-run lobbies in the Join Lobby list (MIN_OPEN_LOBBIES): free for all
// on a real-world map, x5 or x10 gold and a start of 5M or more. Half have
// no missiles.
export const OPEN_LOBBY_ECONOMIES: readonly {
  startingGold: number;
  goldMultiplier: number;
  noMissiles?: boolean;
}[] = [
  { startingGold: 5_000_000, goldMultiplier: 5, noMissiles: true },
  { startingGold: 10_000_000, goldMultiplier: 10 },
  { startingGold: 10_000_000, goldMultiplier: 5, noMissiles: true },
  { startingGold: 25_000_000, goldMultiplier: 5 },
  { startingGold: 5_000_000, goldMultiplier: 10, noMissiles: true },
  { startingGold: 25_000_000, goldMultiplier: 10 },
];
// Scheduled and open lobbies are small, so a game fills fast and every
// player counts. A small map's own cap can make a lobby smaller still.
export const LOBBY_SIZES: readonly number[] = [10, 12, 15, 16, 20];
// The share of ffa, team and special games played on a real-world map
// (PRIME_TIME_MAPS). By ticket weight alone it would be about a fifth.
export const REAL_WORLD_MAP_SHARE = 0.65;
export const GOLD_RUSH_NATION_DIFFICULTIES: readonly Difficulty[] = [
  Difficulty.Medium,
  Difficulty.Hard,
  Difficulty.Impossible,
];
// The units the nukes-disabled modifier removes.
const MISSILE_UNITS: readonly UnitType[] = [
  UnitType.MissileSilo,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.SAMLauncher,
];

// Special games roll ffa/team per-game (see getSpecialConfig), so their
// playlist is split in two rather than sharing one "special" queue -
// each half can then fall back to the matching ffaFrequency/teamFrequency.
type PlaylistKey =
  | "ffa"
  | "team"
  | "specialFfa"
  | "specialTeam"
  | "goldRush"
  | "primeTime"
  | "open";

export class MapPlaylist {
  // Real-world map rounds per queue (see nextRealWorldMap).
  private realWorldPlaylists: Partial<Record<PlaylistKey, GameMapType[]>> = {};
  private lastRealWorldMap: Partial<Record<PlaylistKey, GameMapType>> = {};

  private playlists: Record<PlaylistKey, GameMapType[]> = {
    ffa: [],
    team: [],
    specialFfa: [],
    specialTeam: [],
    goldRush: [],
    primeTime: [],
    open: [],
  };

  // Gold rush games handed out so far: even is no missiles, odd has missiles
  // and a nation difficulty roll.
  private goldRushScheduled = 0;

  // Open lobbies handed out so far: the position in OPEN_LOBBY_ECONOMIES.
  private openLobbiesScheduled = 0;

  // Position of each queue in ECONOMY_ROTATION.
  private economyScheduled = { ffa: 0, team: 0 };

  // Rotation weight overrides from the API (see MapWeights.ts), spread over
  // each map's info.json frequencies when a playlist is built.
  private weightOverrides: MapWeightOverrides = {};

  // Queued playlists were built from the old weights, so drop them: a map
  // pulled to 0 must stop appearing now, not after a full rotation.
  public setWeightOverrides(overrides: MapWeightOverrides) {
    if (JSON.stringify(overrides) === JSON.stringify(this.weightOverrides)) {
      return;
    }
    this.weightOverrides = overrides;
    for (const key of Object.keys(this.playlists) as PlaylistKey[]) {
      this.playlists[key] = [];
    }
    this.realWorldPlaylists = {};
  }

  public async gameConfig(type: ScheduledPublicGameType): Promise<GameConfig> {
    if (type === "special") {
      return this.getSpecialConfig();
    }
    if (type === "goldrush") {
      return this.getGoldRushConfig();
    }

    const mode = type === "ffa" ? GameMode.FFA : GameMode.Team;
    const map = this.getNextMap(type);

    let playerTeams =
      mode === GameMode.Team ? this.getTeamCount(map) : undefined;

    let isCompact: boolean | undefined =
      this.playlists[type].length % 3 === 0 || undefined;
    if (
      isCompact &&
      mode === GameMode.Team &&
      !(await this.supportsCompactMapForTeams(map, playerTeams!))
    ) {
      isCompact = undefined;
    }

    const unadjustedMaxPlayers = await this.lobbyMaxPlayers(map, isCompact);
    playerTeams = this.adjustTeamCountForPlayerCapacity(
      playerTeams,
      unadjustedMaxPlayers,
    );

    const economy =
      ECONOMY_ROTATION[
        this.economyScheduled[type]++ % ECONOMY_ROTATION.length
      ]!;
    const { startingGold, goldMultiplier } = economy;
    const isNukesDisabled =
      economy.noMissiles === true &&
      !(mode === GameMode.Team && SPECIAL_TEAM_MAPS.has(map))
        ? true
        : undefined;

    return {
      donateGold: mode === GameMode.Team,
      donateTroops: mode === GameMode.Team,
      gameMap: map,
      maxPlayers: this.adjustForTeams(unadjustedMaxPlayers, playerTeams),
      gameType: GameType.Public,
      gameMapSize: isCompact ? GameMapSize.Compact : GameMapSize.Normal,
      publicGameModifiers: {
        isCompact,
        startingGold,
        goldMultiplier,
        isNukesDisabled,
      },
      startingGold,
      goldMultiplier,
      difficulty:
        playerTeams === HumansVsNations ? Difficulty.Hard : Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: false,
      nations:
        mode === GameMode.Team && playerTeams !== HumansVsNations
          ? "disabled"
          : "default",
      gameMode: mode,
      playerTeams,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration: this.getSpawnImmunityDuration(
        playerTeams,
        startingGold,
      ),
      disabledUnits: isNukesDisabled ? [...MISSILE_UNITS] : [],
      disableClanTags: mode === GameMode.FFA ? true : undefined,
      // Public FFA is solo: each player sees other humans under a fake name
      // of their own (NameVisibility), so friends cannot find each other to
      // team. Real names stay in the record and show in the replay.
      anonymizeNames: mode === GameMode.FFA ? true : undefined,
      // Overtime (the win threshold sinking after 30 minutes) is the default
      // for every public FFA game, so it carries no lobby modifier badge.
      overtime: mode === GameMode.FFA ? { enabled: true } : undefined,
    } satisfies GameConfig;
  }

  /**
   * The daily prime-time match: plain FFA on a real-world map at its
   * largest player count, with bots and nations to fill the empty slots.
   * No modifiers: it is the match a newcomer should understand.
   */
  public async primeTimeConfig(): Promise<GameConfig> {
    const playlist = this.playlists.primeTime;
    if (playlist.length === 0) {
      playlist.push(
        ...new PseudoRandom(Date.now()).shuffleArray([...PRIME_TIME_MAPS]),
      );
    }
    const map = playlist.shift()!;
    const [maxPlayers] = calculateMapPlayerCounts(await getMapLandTiles(map));
    return {
      donateGold: false,
      donateTroops: false,
      gameMap: map,
      maxPlayers,
      gameType: GameType.Public,
      gameMapSize: GameMapSize.Normal,
      publicGameModifiers: {},
      difficulty: Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: false,
      nations: "default",
      gameMode: GameMode.FFA,
      bots: 400,
      spawnImmunityDuration: this.getSpawnImmunityDuration(),
      disabledUnits: [],
      disableClanTags: true,
      anonymizeNames: true,
      overtime: { enabled: true },
    } satisfies GameConfig;
  }

  /**
   * A server-run lobby for the Join Lobby list. The master opens it with a
   * countdown that runs with or without players, and fillers come and go in
   * it like in the scheduled lobbies.
   */
  public async openLobbyConfig(): Promise<GameConfig> {
    const playlist = this.playlists.open;
    if (playlist.length === 0) {
      playlist.push(
        ...new PseudoRandom(Date.now()).shuffleArray([...PRIME_TIME_MAPS]),
      );
    }
    const map = playlist.shift()!;
    const { startingGold, goldMultiplier, noMissiles } =
      OPEN_LOBBY_ECONOMIES[
        this.openLobbiesScheduled++ % OPEN_LOBBY_ECONOMIES.length
      ]!;
    return {
      donateGold: false,
      donateTroops: false,
      gameMap: map,
      maxPlayers: await this.lobbyMaxPlayers(map),
      gameType: GameType.Public,
      gameMapSize: GameMapSize.Normal,
      publicGameModifiers: {
        startingGold,
        goldMultiplier,
        isNukesDisabled: noMissiles,
      },
      startingGold,
      goldMultiplier,
      difficulty: Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: false,
      nations: "default",
      gameMode: GameMode.FFA,
      bots: 400,
      spawnImmunityDuration: this.getSpawnImmunityDuration(
        undefined,
        startingGold,
      ),
      disabledUnits: noMissiles ? [...MISSILE_UNITS] : [],
      disableClanTags: true,
      anonymizeNames: true,
      overtime: { enabled: true },
    } satisfies GameConfig;
  }

  private async getGoldRushConfig(): Promise<GameConfig> {
    const map = this.getNextMap("goldrush");
    const { startingGold, goldMultiplier } =
      GOLD_RUSH_ECONOMIES[
        Math.floor(this.goldRushScheduled / 2) % GOLD_RUSH_ECONOMIES.length
      ]!;
    const noMissiles = this.goldRushScheduled++ % 2 === 0;
    const difficulty = noMissiles
      ? Difficulty.Medium
      : GOLD_RUSH_NATION_DIFFICULTIES[
          Math.floor(Math.random() * GOLD_RUSH_NATION_DIFFICULTIES.length)
        ]!;
    return {
      donateGold: false,
      donateTroops: false,
      gameMap: map,
      maxPlayers: await this.lobbyMaxPlayers(map),
      gameType: GameType.Public,
      gameMapSize: GameMapSize.Normal,
      publicGameModifiers: {
        startingGold,
        goldMultiplier,
        isNukesDisabled: noMissiles || undefined,
      },
      startingGold,
      goldMultiplier,
      difficulty,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: false,
      // Nations have no PVP immunity, so a rich start normally leaves them
      // out (see rollConfig). Gold rush keeps them in both variants: with few
      // players online, a lobby without nations is one player against bots.
      nations: "default",
      gameMode: GameMode.FFA,
      bots: 400,
      spawnImmunityDuration: this.getSpawnImmunityDuration(
        undefined,
        startingGold,
      ),
      disabledUnits: noMissiles ? [...MISSILE_UNITS] : [],
      disableClanTags: true,
      anonymizeNames: true,
      overtime: { enabled: true },
    } satisfies GameConfig;
  }

  private async getSpecialConfig(): Promise<GameConfig> {
    const mode =
      Math.random() < SPECIAL_FFA_CHANCE ? GameMode.FFA : GameMode.Team;
    const map = this.getNextMap("special", mode);
    let playerTeams =
      mode === GameMode.Team ? this.getTeamCount(map) : undefined;

    // Crowded would force 60 or 125 players, and lobbies stay small
    // (LOBBY_SIZES), also on maps that force it in info.json.
    const excludedModifiers: ModifierKey[] = ["isCrowded"];

    // Check if compact map would leave every team with at least 2 players
    const supportsCompact =
      mode !== GameMode.Team ||
      (await this.supportsCompactMapForTeams(map, playerTeams!));
    if (!supportsCompact) {
      excludedModifiers.push("isCompact");
    }

    // Duos, Trios, and Quads should not get random spawn (as it defeats the purpose)
    if (
      playerTeams === Duos ||
      playerTeams === Trios ||
      playerTeams === Quads
    ) {
      excludedModifiers.push("isRandomSpawn");
    }

    // No gold multi on FourIslands team games - Too high chance of 3h long stalemates
    if (map === GameMapType.FourIslands && mode === GameMode.Team) {
      excludedModifiers.push("goldMultiplier");
    }

    // Hard nations modifier only applies when nations are present (not HvN, which is always hard)
    if (mode === GameMode.Team) {
      excludedModifiers.push("isHardNations");
    }

    // On special team maps nukes-disabled makes cross-water attacks
    // nearly impossible (extreme warship spam).
    if (mode === GameMode.Team && SPECIAL_TEAM_MAPS.has(map)) {
      excludedModifiers.push("isNukesDisabled");
    }

    if (playerTeams === HumansVsNations) {
      excludedModifiers.push("startingGold25M"); // Nations are disabled if that modifier is active (Because of PVP immunity)
      excludedModifiers.push("isPeaceTime"); // Nations don't have PVP immunity
    }

    // Per-map disabled modifiers from info.json (e.g. island maps disable isRandomSpawn).
    const mapInfo = allMaps.find((m) => m.type === map);
    if (mapInfo?.disabledModifiers) {
      for (const mod of mapInfo.disabledModifiers) {
        excludedModifiers.push(mod as ModifierKey);
      }
    }

    // Per-map forced modifiers from info.json. Format: "modifier" (always on)
    // or "modifier:percentage" (e.g. "goldMultiplier:75" = 75% chance).
    // Forced modifiers are excluded from the random pool so they don't
    // get rolled twice, but they respect excludedModifiers.
    // Roll percentage chances now so we can count them toward the 3-modifier cap.
    const appliedForced = new Set<ModifierKey>();
    if (mapInfo?.forcedModifiers) {
      for (const entry of mapInfo.forcedModifiers) {
        const [mod, pctStr] = entry.split(":");
        const key = mod as ModifierKey;
        const chance = pctStr !== undefined ? parseInt(pctStr, 10) / 100 : 1;
        if (!excludedModifiers.includes(key) && Math.random() < chance) {
          appliedForced.add(key);
          excludedModifiers.push(key);
          // Also exclude mutually-exclusive counterpart(s) so the random pool
          // can't roll a conflicting modifier (e.g. isNukesDisabled vs isWaterNukes).
          for (const [a, b] of MUTUALLY_EXCLUSIVE_MODIFIERS) {
            if (key === a && !excludedModifiers.includes(b))
              excludedModifiers.push(b);
            if (key === b && !excludedModifiers.includes(a))
              excludedModifiers.push(a);
          }
        }
      }
      // Cap after all rolls: if more than 3 forced modifiers passed, trim to 3.
      if (appliedForced.size > 3) {
        const trimmed = [...appliedForced].slice(0, 3);
        appliedForced.clear();
        for (const key of trimmed) appliedForced.add(key);
      }
    }

    // Forced modifiers count toward the 3-modifier cap.
    const poolResult = this.getRandomSpecialGameModifiers(
      excludedModifiers,
      undefined,
      appliedForced.size,
    );
    let {
      isCrowded,
      startingGold,
      isCompact,
      isRandomSpawn,
      goldMultiplier,
      isAlliancesDisabled,
      isHardNations,
      isNukesDisabled,
      isSAMsDisabled,
      isPeaceTime,
      isWaterNukes,
      isDoomsdayClock,
    } = poolResult;

    // Apply per-map forced modifiers (already rolled and respecting excludedModifiers).
    if (appliedForced.has("isRandomSpawn")) isRandomSpawn = true;
    if (appliedForced.has("isCompact")) isCompact = true;
    if (appliedForced.has("isCrowded")) isCrowded = true;
    if (appliedForced.has("isHardNations")) isHardNations = true;
    if (appliedForced.has("startingGold1M")) startingGold = 1_000_000;
    if (appliedForced.has("startingGold5M")) startingGold = 5_000_000;
    if (appliedForced.has("startingGold25M")) startingGold = 25_000_000;
    if (appliedForced.has("goldMultiplier"))
      goldMultiplier = SPECIAL_GOLD_MULTIPLIER;
    if (appliedForced.has("isAlliancesDisabled")) isAlliancesDisabled = true;
    if (appliedForced.has("isNukesDisabled")) isNukesDisabled = true;
    if (appliedForced.has("isSAMsDisabled")) isSAMsDisabled = true;
    if (appliedForced.has("isPeaceTime")) isPeaceTime = true;
    if (appliedForced.has("isWaterNukes")) isWaterNukes = true;
    if (appliedForced.has("isDoomsdayClock")) isDoomsdayClock = true;

    // Crowded modifier: if the map's biggest player count (first number of calculateMapPlayerCounts) is 60 or lower (small maps),
    // set player count to CROWDED_PLAYER_COUNT (or CROWDED_COMPACT_PLAYER_COUNT if compact map is also enabled)
    let crowdedMaxPlayers: number | undefined;
    if (isCrowded) {
      crowdedMaxPlayers = await this.getCrowdedMaxPlayers(map, !!isCompact);
      if (crowdedMaxPlayers === undefined) {
        // Map doesn't support crowded. Drop it and pick one replacement only
        // if it was the sole modifier, so the lobby always has at least one.
        isCrowded = undefined;
        if (
          !isRandomSpawn &&
          !isCompact &&
          !isHardNations &&
          startingGold === undefined &&
          goldMultiplier === undefined &&
          !isAlliancesDisabled &&
          !isNukesDisabled &&
          !isSAMsDisabled &&
          !isPeaceTime &&
          !isWaterNukes &&
          !isDoomsdayClock
        ) {
          excludedModifiers.push("isCrowded");
          const fallback = this.getRandomSpecialGameModifiers(
            excludedModifiers,
            1,
          );
          ({
            isRandomSpawn,
            isCompact,
            startingGold,
            goldMultiplier,
            isAlliancesDisabled,
            isNukesDisabled,
            isSAMsDisabled,
            isPeaceTime,
            isWaterNukes,
            isDoomsdayClock,
          } = fallback);
          ({ isHardNations } = fallback);
        }
      }
    }

    const unadjustedMaxPlayers =
      crowdedMaxPlayers ?? (await this.lobbyMaxPlayers(map, isCompact));
    playerTeams = this.adjustTeamCountForPlayerCapacity(
      playerTeams,
      unadjustedMaxPlayers,
    );
    const maxPlayers = Math.max(
      2,
      this.adjustForTeams(unadjustedMaxPlayers, playerTeams),
    );

    const nations: GameConfig["nations"] =
      (mode === GameMode.Team && playerTeams !== HumansVsNations) ||
      // Nations don't have PVP immunity, so 25M starting gold wouldn't work well with them
      (startingGold !== undefined && startingGold >= 25_000_000)
        ? "disabled"
        : "default";

    // Build disabledUnits from modifiers
    const disabledUnits: UnitType[] = [];
    if (isNukesDisabled) {
      disabledUnits.push(...MISSILE_UNITS);
    }
    if (isSAMsDisabled) {
      disabledUnits.push(UnitType.SAMLauncher);
    }

    // 4min peace = 240s = 2400 ticks
    const peaceTimeDuration = isPeaceTime ? 240 * 10 : undefined;

    return {
      donateGold: mode === GameMode.Team,
      donateTroops: mode === GameMode.Team,
      gameMap: map,
      maxPlayers,
      gameType: GameType.Public,
      gameMapSize: isCompact ? GameMapSize.Compact : GameMapSize.Normal,
      publicGameModifiers: {
        isCompact,
        isRandomSpawn,
        isCrowded,
        isHardNations,
        startingGold,
        goldMultiplier,
        isAlliancesDisabled,
        isNukesDisabled,
        isSAMsDisabled,
        isPeaceTime,
        isWaterNukes,
        isDoomsdayClock,
      },
      // Rolled into the rotation: enable the anti-stall clock at a speed picked
      // per game so the pacing varies across the presets.
      doomsdayClock: isDoomsdayClock
        ? {
            enabled: true,
            speed:
              DOOMSDAY_ROTATION_SPEEDS[
                Math.floor(Math.random() * DOOMSDAY_ROTATION_SPEEDS.length)
              ],
          }
        : undefined,
      startingGold,
      goldMultiplier,
      disableAlliances: isAlliancesDisabled ? true : undefined,
      difficulty:
        isHardNations || playerTeams === HumansVsNations
          ? Difficulty.Hard
          : Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: isRandomSpawn ? true : false,
      nations,
      gameMode: mode,
      playerTeams,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration:
        peaceTimeDuration ??
        this.getSpawnImmunityDuration(playerTeams, startingGold),
      disabledUnits,
      waterNukes: isWaterNukes ? true : undefined,
      disableClanTags: mode === GameMode.FFA ? true : undefined,
      anonymizeNames: mode === GameMode.FFA ? true : undefined,
    } satisfies GameConfig;
  }

  private getNextMap(
    type: ScheduledPublicGameType,
    mode?: GameMode,
  ): GameMapType {
    const key = this.playlistKey(type, mode);
    if (type !== "goldrush" && Math.random() < REAL_WORLD_MAP_SHARE) {
      const map = this.nextRealWorldMap(key, type, mode);
      if (map !== undefined) return map;
    }
    const playlist = this.playlists[key];
    if (playlist.length === 0) {
      playlist.push(...this.generateNewPlaylist(type, mode));
    }
    if (playlist.length === 0) {
      // The overrides zeroed every map in this queue; fall back to the build.
      log.warn(`Map weight overrides empty the ${key} playlist, ignoring them`);
      playlist.push(...this.generateNewPlaylist(type, mode, {}));
    }
    return playlist.shift()!;
  }

  // The next real-world map this queue plays. Each map the queue allows comes
  // up once per round, in a new order every round. Undefined when the queue
  // allows none of them.
  private nextRealWorldMap(
    key: PlaylistKey,
    type: ScheduledPublicGameType,
    mode?: GameMode,
  ): GameMapType | undefined {
    const playlist = (this.realWorldPlaylists[key] ??= []);
    if (playlist.length === 0) {
      const allowed = PRIME_TIME_MAPS.filter(
        (map) => this.mapFrequency(map, type, mode, this.weightOverrides) > 0,
      );
      const next = new PseudoRandom(Date.now()).shuffleArray([...allowed]);
      // A new round never opens with the map that closed the last one.
      if (next.length > 1 && next[0] === this.lastRealWorldMap[key]) {
        next.push(next.shift()!);
      }
      playlist.push(...next);
    }
    const map = playlist.shift();
    if (map !== undefined) this.lastRealWorldMap[key] = map;
    return map;
  }

  private playlistKey(
    type: ScheduledPublicGameType,
    mode?: GameMode,
  ): PlaylistKey {
    if (type === "special") {
      return mode === GameMode.Team ? "specialTeam" : "specialFfa";
    }
    if (type === "goldrush") return "goldRush";
    return type;
  }

  private generateNewPlaylist(
    type: ScheduledPublicGameType,
    mode?: GameMode,
    overrides: MapWeightOverrides = this.weightOverrides,
  ): GameMapType[] {
    const maps = this.buildMapsList(type, mode, overrides);
    const rand = new PseudoRandom(Date.now());
    const playlist: GameMapType[] = [];

    const numAttempts = 10000;
    for (let attempt = 0; attempt < numAttempts; attempt++) {
      playlist.length = 0;
      // Re-shuffle every attempt so retries can explore different orderings.
      const source = rand.shuffleArray([...maps]);

      let success = true;
      while (source.length > 0) {
        if (!this.addNextMapNonConsecutive(playlist, source)) {
          success = false;
          break;
        }
      }

      if (success) {
        log.info(`Generated map playlist in ${attempt} attempts`);
        return playlist;
      }
    }

    log.warn(
      `Failed to generate non-consecutive playlist after ${numAttempts} attempts, falling back to shuffle`,
    );
    return rand.shuffleArray([...maps]);
  }

  private addNextMapNonConsecutive(
    playlist: GameMapType[],
    source: GameMapType[],
  ): boolean {
    const nonConsecutiveNum = 5;
    const lastMaps = playlist.slice(-nonConsecutiveNum);

    for (let i = 0; i < source.length; i++) {
      const map = source[i];
      if (!lastMaps.includes(map)) {
        source.splice(i, 1);
        playlist.push(map);
        return true;
      }
    }
    return false;
  }

  private buildMapsList(
    type: ScheduledPublicGameType,
    mode: GameMode | undefined,
    overrides: MapWeightOverrides,
  ): GameMapType[] {
    const maps: GameMapType[] = [];
    for (const { type: map } of allMaps) {
      // The real-world maps have a rotation of their own (getNextMap).
      if (type !== "goldrush" && PRIME_TIME_MAPS.includes(map)) continue;
      const freq = this.mapFrequency(map, type, mode, overrides);
      for (let i = 0; i < freq; i++) {
        maps.push(map);
      }
    }
    return maps;
  }

  // A map's tickets in a queue's rotation.
  private mapFrequency(
    map: GameMapType,
    type: ScheduledPublicGameType,
    mode: GameMode | undefined,
    overrides: MapWeightOverrides,
  ): number {
    const buildInfo = allMaps.find((m) => m.type === map)!;
    const mapInfo = { ...buildInfo, ...overrides[map] };
    // Use per-mode frequency if set (>= 0), otherwise fall back to multiplayerFrequency.
    switch (type) {
      case "ffa":
        return mapInfo.ffaFrequency >= 0
          ? mapInfo.ffaFrequency
          : mapInfo.multiplayerFrequency;
      case "team":
        return mapInfo.teamFrequency >= 0
          ? mapInfo.teamFrequency
          : mapInfo.multiplayerFrequency;
      case "special":
        // Special games are rolled as ffa or team (see getSpecialConfig), so
        // fall back to the matching per-mode frequency before multiplayerFrequency.
        // The per-mode frequency only counts here when it's a deliberate positive
        // weight - a map opted out of ffa/team entirely (frequency 0, e.g. Sol,
        // ArchipelagoSea) should still reach special via multiplayerFrequency.
        if (mapInfo.specialFrequency >= 0) {
          return mapInfo.specialFrequency;
        } else if (mode === GameMode.Team) {
          return mapInfo.teamFrequency > 0
            ? mapInfo.teamFrequency
            : mapInfo.multiplayerFrequency;
        }
        return mapInfo.ffaFrequency > 0
          ? mapInfo.ffaFrequency
          : mapInfo.multiplayerFrequency;
      case "goldrush":
        // A fixed list, one ticket each: the map files decide nothing here.
        return GOLD_RUSH_MAPS.includes(map) ? 1 : 0;
    }
  }

  private getTeamCount(map: GameMapType): TeamCountConfig {
    // Override team count for specific maps
    const forcedTeamCount = SPECIAL_TEAM_MAPS.get(map);
    if (
      forcedTeamCount !== undefined &&
      Math.random() < SPECIAL_TEAM_FORCE_CHANCE
    ) {
      return forcedTeamCount;
    }

    const totalWeight = TEAM_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
    const roll = Math.random() * totalWeight;

    let cumulativeWeight = 0;
    for (const { config, weight } of TEAM_WEIGHTS) {
      cumulativeWeight += weight;
      if (roll < cumulativeWeight) {
        return config;
      }
    }
    return TEAM_WEIGHTS[0].config;
  }

  private getRandomSpecialGameModifiers(
    excludedModifiers: ModifierKey[] = [],
    count?: number,
    countReduction: number = 0,
  ): PublicGameModifiers {
    // Roll how many modifiers to pick: 30% → 1, 50% → 2, 20% → 3
    const modifierCounts = [1, 1, 1, 2, 2, 2, 2, 2, 3, 3];
    const rolled =
      modifierCounts[Math.floor(Math.random() * modifierCounts.length)];
    const k = Math.max(0, (count ?? rolled) - countReduction);

    // Shuffle the pool, then pick the first k unique modifier keys.
    const pool = SPECIAL_MODIFIER_POOL.filter(
      (key) => !excludedModifiers.includes(key),
    ).sort(() => Math.random() - 0.5);

    const selected = new Set<ModifierKey>();
    for (const key of pool) {
      if (selected.size >= k) break;
      // Skip if a mutually exclusive modifier is already selected
      const blocked = MUTUALLY_EXCLUSIVE_MODIFIERS.some(
        ([a, b]) =>
          (key === a && selected.has(b)) || (key === b && selected.has(a)),
      );
      if (!blocked) selected.add(key);
    }

    return {
      isRandomSpawn: selected.has("isRandomSpawn") || undefined,
      isCompact: selected.has("isCompact") || undefined,
      isCrowded: selected.has("isCrowded") || undefined,
      isHardNations: selected.has("isHardNations") || undefined,
      startingGold: selected.has("startingGold25M")
        ? 25_000_000
        : selected.has("startingGold5M")
          ? 5_000_000
          : selected.has("startingGold1M")
            ? 1_000_000
            : undefined,
      goldMultiplier: selected.has("goldMultiplier")
        ? SPECIAL_GOLD_MULTIPLIER
        : undefined,
      isAlliancesDisabled: selected.has("isAlliancesDisabled") || undefined,
      isNukesDisabled: selected.has("isNukesDisabled") || undefined,
      isSAMsDisabled: selected.has("isSAMsDisabled") || undefined,
      isPeaceTime: selected.has("isPeaceTime") || undefined,
      isWaterNukes: selected.has("isWaterNukes") || undefined,
      isDoomsdayClock: selected.has("isDoomsdayClock") || undefined,
    };
  }

  // Check whether a compact map still gives every team at least 2 players,
  // using the worst-case player tier (smallest) from lobbyMaxPlayers.
  private async supportsCompactMapForTeams(
    map: GameMapType,
    playerTeams: TeamCountConfig,
  ): Promise<boolean> {
    const landTiles = await getMapLandTiles(map);
    const [l, , s] = calculateMapPlayerCounts(landTiles);
    // Worst case: smallest tier with team mode 1.5x multiplier, capped at l
    let p = Math.min(Math.ceil(s * 1.5), l);
    // Apply compact 75% player reduction
    p = Math.max(3, Math.floor(p * 0.25));
    // Apply team adjustment
    p = this.adjustForTeams(p, playerTeams);
    return this.supportsTeamPlayerCount(p, playerTeams);
  }

  private supportsTeamPlayerCount(
    adjustedPlayerCount: number,
    playerTeams: TeamCountConfig,
  ): boolean {
    return (
      this.playersPerTeam(adjustedPlayerCount, playerTeams) >= 2 &&
      this.numberOfTeams(adjustedPlayerCount, playerTeams) >= 2
    );
  }

  private playersPerTeam(
    adjustedPlayerCount: number,
    playerTeams: TeamCountConfig,
  ): number {
    switch (playerTeams) {
      case Duos:
        return Math.min(2, adjustedPlayerCount);
      case Trios:
        return Math.min(3, adjustedPlayerCount);
      case Quads:
        return Math.min(4, adjustedPlayerCount);
      case HumansVsNations:
        return adjustedPlayerCount; // adjustedPlayerCount is the human count
      default:
        return Math.floor(adjustedPlayerCount / playerTeams);
    }
  }

  private numberOfTeams(
    adjustedPlayerCount: number,
    playerTeams: TeamCountConfig,
  ): number {
    switch (playerTeams) {
      case Duos:
        return Math.floor(adjustedPlayerCount / 2);
      case Trios:
        return Math.floor(adjustedPlayerCount / 3);
      case Quads:
        return Math.floor(adjustedPlayerCount / 4);
      case HumansVsNations:
        return 2; // always 2 teams
      default:
        return playerTeams; // numeric value IS the team count
    }
  }

  /**
   * Centralised spawn-immunity duration logic.
   * - HumansVsNations: always 5s (nations can't benefit from longer PVP immunity)
   * - 25M starting gold: 2:30min (extra time to compensate for high gold)
   * - 5M starting gold: SAM build time + 15s (enough to build a SAM)
   * - Default: 5s
   */
  private getSpawnImmunityDuration(
    playerTeams?: TeamCountConfig,
    startingGold?: number,
  ): number {
    if (playerTeams === HumansVsNations) return 5 * 10;
    if (startingGold !== undefined && startingGold >= 25_000_000)
      return 150 * 10;
    if (startingGold !== undefined && startingGold >= 5_000_000)
      return SAM_CONSTRUCTION_TICKS + 15 * 10;
    return 5 * 10;
  }

  private async getCrowdedMaxPlayers(
    map: GameMapType,
    isCompact: boolean,
  ): Promise<number | undefined> {
    const landTiles = await getMapLandTiles(map);
    const [firstPlayerCount] = calculateMapPlayerCounts(landTiles);
    if (firstPlayerCount <= 60) {
      return isCompact ? CROWDED_COMPACT_PLAYER_COUNT : CROWDED_PLAYER_COUNT;
    }
    return undefined;
  }

  private async lobbyMaxPlayers(
    map: GameMapType,
    isCompactMap?: boolean,
  ): Promise<number> {
    const landTiles = await getMapLandTiles(map);
    const [l] = calculateMapPlayerCounts(landTiles);
    const size = LOBBY_SIZES[Math.floor(Math.random() * LOBBY_SIZES.length)]!;
    // A compact map has a quarter of the land.
    const cap = isCompactMap ? Math.max(3, Math.floor(l * 0.25)) : l;
    return Math.min(size, cap);
  }

  // Numeric team modes specify a number of teams, so ensure every team can
  // receive at least two players before rounding the lobby capacity.
  private adjustTeamCountForPlayerCapacity(
    playerTeams: TeamCountConfig | undefined,
    unadjustedMaxPlayers: number,
  ): TeamCountConfig | undefined {
    if (
      typeof playerTeams !== "number" ||
      this.supportsTeamPlayerCount(
        this.adjustForTeams(unadjustedMaxPlayers, playerTeams),
        playerTeams,
      )
    ) {
      return playerTeams;
    }

    return Math.max(2, Math.floor(unadjustedMaxPlayers / 2));
  }

  private adjustForTeams(
    playerCount: number,
    numPlayerTeams: TeamCountConfig | undefined,
  ): number {
    if (numPlayerTeams === undefined) return playerCount;
    let p = playerCount;
    switch (numPlayerTeams) {
      case Duos:
        p -= p % 2;
        break;
      case Trios:
        p -= p % 3;
        break;
      case Quads:
        p -= p % 4;
        break;
      case HumansVsNations:
        // Half the slots are for humans, the other half will get filled with nations
        p = Math.floor(p / 2);
        break;
      default:
        p -= p % numPlayerTeams;
        break;
    }
    return p;
  }
}
