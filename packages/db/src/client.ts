import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
}

// Opens a connection pool. The caller owns it and closes it with pool.end().
// `max` caps the connections this one pool may hold open.
export function createDb(connectionString: string, max = 10): DbHandle {
  const pool = new pg.Pool({ connectionString, max });
  // An idle client that loses its connection (a database restart or
  // failover) is reported here. Without a listener it would crash the
  // process; the pool drops the client and opens a new one on next use.
  pool.on("error", (err) => {
    console.error("Postgres pool error:", err.message);
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
