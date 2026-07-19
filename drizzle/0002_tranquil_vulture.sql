ALTER TABLE "drivers" ADD COLUMN "driver_code" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "previous_teams" text[] DEFAULT '{}' NOT NULL;