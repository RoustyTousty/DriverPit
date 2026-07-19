CREATE TABLE "duel_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_a" uuid NOT NULL,
	"player_b" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_round" integer DEFAULT 1 NOT NULL,
	"score_a" integer DEFAULT 0 NOT NULL,
	"score_b" integer DEFAULT 0 NOT NULL,
	"winner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "duel_round_results" (
	"match_id" integer NOT NULL,
	"round_index" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"solved_at" timestamp with time zone,
	"guess_count" integer DEFAULT 0 NOT NULL,
	"best_proximity" numeric,
	"points" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "duel_round_results_match_id_round_index_user_id_pk" PRIMARY KEY("match_id","round_index","user_id")
);
--> statement-breakpoint
CREATE TABLE "duel_rounds" (
	"match_id" integer NOT NULL,
	"round_index" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "duel_rounds_match_id_round_index_pk" PRIMARY KEY("match_id","round_index")
);
--> statement-breakpoint
CREATE TABLE "matchmaking_queue" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"pool_window" text NOT NULL,
	"rating" integer NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "duel_matches" ADD CONSTRAINT "duel_matches_player_a_profiles_id_fk" FOREIGN KEY ("player_a") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_matches" ADD CONSTRAINT "duel_matches_player_b_profiles_id_fk" FOREIGN KEY ("player_b") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_matches" ADD CONSTRAINT "duel_matches_winner_id_profiles_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_round_results" ADD CONSTRAINT "duel_round_results_match_id_duel_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."duel_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_round_results" ADD CONSTRAINT "duel_round_results_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_rounds" ADD CONSTRAINT "duel_rounds_match_id_duel_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."duel_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_rounds" ADD CONSTRAINT "duel_rounds_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmaking_queue" ADD CONSTRAINT "matchmaking_queue_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;