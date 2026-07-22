CREATE TABLE "infinite_rounds" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"pool_window" text NOT NULL,
	"guess_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "infinite_rounds" ADD CONSTRAINT "infinite_rounds_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infinite_rounds" ADD CONSTRAINT "infinite_rounds_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;