-- Avatars moved from a fixed 8-icon preset set to DiceBear-generated
-- characters (see lib/avatars.tsx) -- avatar_url now holds an arbitrary
-- seed string rather than "preset-N". The new user's own id is already
-- unique and random, so it doubles as a good default seed: every guest
-- gets a distinct, deterministic character for free, no extra column or
-- app-side assignment step needed. Old "preset-N" rows keep working
-- unchanged -- they just become the seed for whichever character that
-- string happens to hash to.
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
    NEW.id::text,
    COALESCE(NEW.is_anonymous, false)
  );

  INSERT INTO public.user_stats (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;