CREATE TABLE "daily_puzzles" (
	"date" date PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"nationality" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"debut_year" integer NOT NULL,
	"career_wins" integer DEFAULT 0 NOT NULL,
	"last_team" text,
	"is_eligible" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duel_players" (
	"room_code" text NOT NULL,
	"player_id" text NOT NULL,
	"guesses" jsonb,
	"finished_at" timestamp with time zone,
	CONSTRAINT "duel_players_room_code_player_id_pk" PRIMARY KEY("room_code","player_id")
);
--> statement-breakpoint
CREATE TABLE "duel_rooms" (
	"code" text PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD CONSTRAINT "daily_puzzles_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_players" ADD CONSTRAINT "duel_players_room_code_duel_rooms_code_fk" FOREIGN KEY ("room_code") REFERENCES "public"."duel_rooms"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_rooms" ADD CONSTRAINT "duel_rooms_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;