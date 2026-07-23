CREATE TABLE "daily_progress" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"guesses" integer[] DEFAULT '{}' NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"won" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_progress_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "daily_progress" ADD CONSTRAINT "daily_progress_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Server-authoritative daily board state (CLAUDE.md "Daily persistence &
-- sync"). RLS is enabled with a SELECT-only self policy and, deliberately, NO
-- write policy of any kind -- same "default deny for writes" treatment as
-- user_stats (drizzle/0008). Every append goes through the trusted Drizzle
-- server connection (lib/db/dailyProgress.ts#dailySubmitGuessFor), which
-- bypasses RLS; a permissive client INSERT/UPDATE policy would just let a
-- client append arbitrary guesses or un-complete a finished day straight over
-- PostgREST -- exactly the tamper vector the "server owns the append" rule
-- exists to close. A client may still read its own row (the guessed ids are
-- the player's own answers, not a secret); the target is never stored here at
-- all, so self-SELECT can't leak it.
ALTER TABLE public.daily_progress ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "daily_progress_select_own" ON public.daily_progress
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);