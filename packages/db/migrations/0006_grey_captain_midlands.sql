ALTER TABLE "game_players" ADD COLUMN "clan_tag" text;--> statement-breakpoint
CREATE INDEX "game_players_clan_tag_idx" ON "game_players" USING btree ("clan_tag");