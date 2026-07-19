CREATE TABLE "daily_results" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"won" boolean NOT NULL,
	"guess_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_results_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "user_stats" ALTER COLUMN "guess_distribution" SET DEFAULT '[0,0,0,0,0]'::jsonb;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "last_result" jsonb;--> statement-breakpoint
ALTER TABLE "daily_results" ADD CONSTRAINT "daily_results_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;