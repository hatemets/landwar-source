import { defineConfig } from "drizzle-kit";

// Generate a migration after a schema change: pnpm run db:generate
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
