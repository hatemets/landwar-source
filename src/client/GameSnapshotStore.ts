/**
 * The latest engine snapshot of the game this browser is playing, so a
 * player who reloads the page (or reopens the tab) resumes from it instead
 * of re-running every turn since the start. Kept in IndexedDB, gzipped, one
 * game at a time.
 *
 * Everything here is best effort: storage can be missing, full or blocked
 * (private windows, cleared site data), and then the game is just replayed
 * from turn 0 as before. A snapshot only continues hash-identically on the
 * build that wrote it, so a snapshot from another build is never used.
 */

import { ClientEnv } from "./ClientEnv";
import { gunzipInBrowser, gzipInBrowser } from "./replay/BrowserGzip";

export interface StoredGameSnapshot {
  gameID: string;
  /** The client's git commit when it was taken. */
  build: string;
  /** The game's tick when it was taken: the next turn to send the engine. */
  tick: number;
  /** When it was taken (ms since epoch). */
  savedAt: number;
  /** The gzipped snapshot. */
  data: Uint8Array;
}

/** Older snapshots are of games that have long ended. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

const DB_NAME = "openfront-game-snapshots";
const DB_VERSION = 1;
const SNAPSHOTS = "snapshots";
/** Rather replay the game than wait on a blocked database. */
const OPEN_TIMEOUT_MS = 2000;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** The database, or null if there is none or it didn't open in time. */
function database(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), OPEN_TIMEOUT_MS);
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(SNAPSHOTS, { keyPath: "gameID" });
    };
    open.onsuccess = () => {
      clearTimeout(timer);
      resolve(open.result);
    };
    open.onerror = () => {
      clearTimeout(timer);
      console.warn("game snapshot store: open failed", open.error);
      resolve(null);
    };
  });
  return dbPromise;
}

/**
 * The stored snapshot of a game, uncompressed, with the tick it was taken
 * at; undefined if there is none this build can use. Never throws.
 */
export async function loadGameSnapshot(
  gameID: string,
): Promise<{ tick: number; snapshot: Uint8Array } | undefined> {
  try {
    const db = await database();
    if (db === null) return undefined;
    const tx = db.transaction(SNAPSHOTS, "readonly");
    const stored = (await request(tx.objectStore(SNAPSHOTS).get(gameID))) as
      | StoredGameSnapshot
      | undefined;
    if (stored === undefined) return undefined;
    if (
      stored.build !== ClientEnv.gitCommit() ||
      Date.now() - stored.savedAt > MAX_AGE_MS
    ) {
      await removeGameSnapshot(gameID);
      return undefined;
    }
    return { tick: stored.tick, snapshot: await gunzipInBrowser(stored.data) };
  } catch (err) {
    console.warn("game snapshot store: read failed", err);
    return undefined;
  }
}

/**
 * Keep a game's snapshot, replacing every stored one (a browser plays one
 * game at a time). Never throws.
 */
export async function saveGameSnapshot(
  gameID: string,
  tick: number,
  snapshot: Uint8Array,
): Promise<void> {
  try {
    const data = await gzipInBrowser(snapshot);
    const db = await database();
    if (db === null) return;
    const tx = db.transaction(SNAPSHOTS, "readwrite");
    const store = tx.objectStore(SNAPSHOTS);
    store.clear();
    store.put({
      gameID,
      build: ClientEnv.gitCommit(),
      tick,
      savedAt: Date.now(),
      data,
    } satisfies StoredGameSnapshot);
    await done(tx);
  } catch (err) {
    console.warn("game snapshot store: write failed", err);
  }
}

/** Forget a game's snapshot. Never throws. */
export async function removeGameSnapshot(gameID: string): Promise<void> {
  try {
    const db = await database();
    if (db === null) return;
    const tx = db.transaction(SNAPSHOTS, "readwrite");
    tx.objectStore(SNAPSHOTS).delete(gameID);
    await done(tx);
  } catch (err) {
    console.warn("game snapshot store: remove failed", err);
  }
}
