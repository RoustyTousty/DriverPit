-- Audit 2026-07-27 §3.6 -- the follow-up drizzle/0042 deliberately left open.
--
-- `profiles_update_own` (drizzle/0006) is FOR UPDATE with no column
-- restriction, and RLS cannot express one: a policy's USING sees the old row
-- and its WITH CHECK sees the new one, but nothing in a policy can compare the
-- two, so "this column may not change" is not a thing a policy can say. The
-- ROW filter was always right; the COLUMN filter was missing, and Postgres
-- spells that as a column-level GRANT.
--
-- What was reachable: `supabase.from("profiles").update({ is_guest: false })`
-- passed auth.uid() = id cleanly, promoting a throwaway anonymous session onto
-- the leaderboard, which filters on is_guest = false (0009, 0037).
-- handle_user_updated only re-syncs is_guest when auth.users.is_anonymous
-- changes, so a hand-flipped value was never corrected. `username` was
-- writable the same way, which is handle impersonation.
--
-- Settings -> Profile writes exactly two columns: display_name
-- (ProfileSection) and avatar_url (AvatarPicker). Those two, and nothing else.
REVOKE UPDATE ON public.profiles FROM authenticated;
--> statement-breakpoint

-- `id`, `username`, `is_guest` and `created_at` become server-owned in exactly
-- the way every other table's columns already are. The signup trigger and
-- handle_user_updated are SECURITY DEFINER and run as the table owner, so
-- neither is affected; nor is the trusted Drizzle connection.
GRANT UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;
--> statement-breakpoint

-- The second half of §3.6: neither editable column had a server-side bound.
-- The maxLength={32} on ProfileSection's input is client-only, and PostgREST
-- is reachable without ever loading it. React escaping rules out XSS; what was
-- open is unbounded text, and control characters or padding used to break the
-- leaderboard's layout or to render a lookalike of someone else's handle.
--
-- Existing rows first, so the constraints below can be added VALIDATED rather
-- than NOT VALID -- a constraint that has never been checked is a constraint
-- nobody can rely on.
UPDATE public.profiles
SET display_name = nullif(btrim(left(btrim(regexp_replace(display_name, '[[:cntrl:]]', '', 'g')), 32)), '')
WHERE display_name IS NOT NULL
  AND (display_name <> btrim(display_name)
       OR char_length(display_name) NOT BETWEEN 1 AND 32
       OR display_name ~ '[[:cntrl:]]');
--> statement-breakpoint

UPDATE public.profiles
SET avatar_url = left(btrim(regexp_replace(avatar_url, '[[:cntrl:]]', '', 'g')), 64)
WHERE char_length(avatar_url) NOT BETWEEN 1 AND 64
   OR avatar_url ~ '[[:cntrl:]]';
--> statement-breakpoint

-- btrim-equality rather than a trim-on-write trigger: the client already sends
-- a trimmed value, so rejecting an untrimmed one surfaces a real disagreement
-- instead of silently rewriting what someone asked for.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_shape CHECK (
    display_name IS NULL
    OR (display_name = btrim(display_name)
        AND char_length(display_name) BETWEEN 1 AND 32
        AND display_name !~ '[[:cntrl:]]')
  );
--> statement-breakpoint

-- avatar_url holds a DiceBear SEED, not a URL or a path (lib/avatars.tsx), so
-- the bound is generous on purpose: curated words ("Apex"), 8-char uuid slices,
-- and the legacy "preset-N" values all fit far inside it. It exists to stop
-- megabyte writes, not to enumerate valid seeds.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_url_shape CHECK (
    char_length(avatar_url) BETWEEN 1 AND 64
    AND avatar_url !~ '[[:cntrl:]]'
  );
