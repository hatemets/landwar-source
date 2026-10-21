import { createDb, type DbHandle } from "@landwar/db/client";
import { databaseUrl } from "./auth/config";

let handle: DbHandle | null = null;

// One pool per process. Created on first use so a process that never touches
// the database does not open one.
export function db(): DbHandle {
  handle ??= createDb(databaseUrl(), poolMax());
  return handle;
}

// Connections each process may hold. The master and every worker have a
// pool, so a small database (Cloud SQL's shared-core tiers allow about 25)
// needs DB_POOL_MAX * (NUM_WORKERS + 1) to stay under its limit.
export function poolMax(): number {
  const raw = process.env.DB_POOL_MAX;
  if (raw === undefined || raw === "") return 10;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid DB_POOL_MAX: ${JSON.stringify(raw)}`);
  }
  return n;
}
