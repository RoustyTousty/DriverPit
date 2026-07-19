-- Cross-schema FK to Supabase's auth.users, which Drizzle doesn't manage
-- (it isn't part of lib/db/schema.ts). user_stats.user_id already FKs to
-- profiles.id (added in 0005), and profiles.id now FKs to auth.users.id,
-- so referential integrity back to auth.users holds transitively for both
-- tables without a redundant second FK on user_stats.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_id_auth_users_id_fk"
  FOREIGN KEY ("id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- Guaranteed-unique "userXXXXXX" handle for guests (and the initial handle
-- for everyone, until profile editing exists). SECURITY DEFINER so it can
-- be called from handle_new_user() below, which itself runs as the
-- function owner rather than the signing-up user (who has no INSERT grant
-- on profiles).
CREATE OR REPLACE FUNCTION public.gen_guest_username()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate text;
BEGIN
  LOOP
    candidate := 'user' || lpad(floor(random() * 1000000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;
--> statement-breakpoint

-- Seeds one profiles + user_stats row for every new auth.users row (guest
-- or full signup alike -- Supabase issues an INSERT either way). The
-- avatar pick is a deterministic hash of the id, from a small fixed set of
-- preset keys -- not a real asset path, just something a future avatar UI
-- can map to an image.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url, is_guest)
  VALUES (
    NEW.id,
    public.gen_guest_username(),
    'preset-' || (1 + (abs(hashtext(NEW.id::text)) % 8))::text,
    COALESCE(NEW.is_anonymous, false)
  );

  INSERT INTO public.user_stats (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- Keeps profiles.is_guest server-authoritative: when a guest upgrades
-- (email confirmed, or an OAuth identity linked), Supabase flips
-- auth.users.is_anonymous to false -- mirror that onto the profile so the
-- same row just stops being a guest, rather than needing a new one.
CREATE OR REPLACE FUNCTION public.handle_user_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_anonymous IS DISTINCT FROM OLD.is_anonymous THEN
    UPDATE public.profiles
    SET is_guest = COALESCE(NEW.is_anonymous, false)
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_updated();
--> statement-breakpoint

-- RLS: self read/write only. Deliberately no INSERT/DELETE policy on
-- either table for the `authenticated` role -- rows come solely from the
-- SECURITY DEFINER trigger functions above, which run as the function
-- owner and bypass RLS entirely, so no client-facing insert path exists.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);
--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
--> statement-breakpoint

-- NOTE: broad self-UPDATE on user_stats (any column, including
-- duel_rating/wins) is fine for this foundation task -- nothing writes to
-- it from the client yet. Once game-result writes exist they should go
-- through trusted server code (Drizzle's `db`, which bypasses RLS
-- entirely -- see lib/db/index.ts), and this policy should likely be
-- narrowed or dropped so a client can't PATCH its own rating directly via
-- PostgREST.
CREATE POLICY "user_stats_select_own" ON public.user_stats
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint
CREATE POLICY "user_stats_update_own" ON public.user_stats
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.user_stats TO authenticated;
