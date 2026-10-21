ALTER TABLE "clan_bans" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clan_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clan_requests" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clans" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "clan_bans" CASCADE;--> statement-breakpoint
DROP TABLE "clan_members" CASCADE;--> statement-breakpoint
DROP TABLE "clan_requests" CASCADE;--> statement-breakpoint
DROP TABLE "clans" CASCADE;--> statement-breakpoint
DROP INDEX "game_players_clan_tag_idx";--> statement-breakpoint
ALTER TABLE "game_players" DROP COLUMN "clan_tag";