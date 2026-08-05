import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Cookie-backed client for use in Client Components. Session (including the
// silent anonymous sign-in) is persisted via cookies rather than
// localStorage so the server (middleware, Server Components, route
// handlers) can see the same session — that's what lets RLS-scoped reads
// happen from either side.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// A throwaway client that touches NOTHING the app is using: no cookie writes,
// no token refresh, no URL parsing. Its one caller is AuthProvider's password
// sign-in, which needs to answer "are these credentials right?" *before* it
// releases the outgoing guest's server-side commitments -- releasing first and
// then failing on a typo would forfeit a live match for nothing.
//
// It must be createClient() and not createSupabaseBrowserClient(): the browser
// client stores its session in cookies, so a second instance signing in would
// overwrite the live session as a side effect of the question, which is the
// exact thing this call is trying not to do yet.
export function createSupabaseProbeClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
