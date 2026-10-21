ALTER TABLE "games" ADD COLUMN "game_type" text DEFAULT 'Public' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "difficulty" text DEFAULT 'Medium' NOT NULL;