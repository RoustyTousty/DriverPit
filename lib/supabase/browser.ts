import { createBrowserClient } from "@supabase/ssr";

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
