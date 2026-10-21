CREATE TABLE "game_records" (
	"game_id" text PRIMARY KEY NOT NULL,
	"record" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_records" ADD CONSTRAINT "game_records_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;