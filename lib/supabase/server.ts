import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cookie-backed client for Server Components, Server Actions, and route
// handlers. Reads the session from the incoming request's cookies (kept
// fresh by middleware.ts) so server-side code sees the same identity the
// browser has.
//
// Server Components can't write cookies (Next.js throws), which is fine
// here: middleware already re-sets refreshed cookies on the response for
// every request, so a no-op `setAll` in that context just skips a
// redundant write rather than losing anything.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component render, where cookies are
            // read-only — middleware.ts is responsible for persisting
            // refreshed session cookies in that case.
          }
        },
      },
    },
  );
}
