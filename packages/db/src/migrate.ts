import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { fileURLToPath } from "url";
import { createDb } from "./client";

// Arbitrary constant shared by every migration runner.
const MIGRATION_LOCK_ID = 727_274_001;

// Applies every SQL migration in packages/db/migrations. Run from the repo
// root with: pnpm run db:migrate
export async function runMigrations(connectionString: string): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { db, pool } = createDb(connectionString);
  // One runner at a time: two processes starting together would both try to
  // create the same tables. The lock lasts as long as this connection.
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(db, { migrationsFolder: path.join(here, "../migrations") });
  } finally {
    await lock
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
      .catch(() => {});
    lock.release();
    await pool.end();
  }
}

const isEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntry) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  await runMigrations(url);
  console.log("migrations applied");
}
