import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lands here after an OAuth redirect (Google sign-in, or linkIdentity()
// upgrading an anonymous guest). Exchanges the auth code for a session —
// this writes the session cookies via the server client's setAll, so by
// the time we redirect the browser already has a valid session.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/daily";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("OAuth code exchange failed", error);
  }

  return NextResponse.redirect(`${origin}/daily?error=oauth_callback_failed`);
}
