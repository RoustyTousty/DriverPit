// The email + password half of Settings -> Profile, kept pure so the same
// rules apply in all three places that use them: the "Create account" tab, the
// "Sign in" tab, and app/auth/reset-password (which sets a password with no
// email in sight and so has no other way to agree about what a valid one is).
//
// None of this is a security boundary -- GoTrue re-validates everything, and
// PostgREST is reachable without our form. It exists so the common mistakes are
// answered instantly and locally instead of costing a round trip and coming
// back as a raw API string.

// Supabase's own default floor is 6. We ask for 8 because the only thing this
// password protects is an account the player can otherwise reach by staying
// signed in, so the cost of two extra characters is paid once and the benefit
// is a password that survives being reused. If the Supabase project is
// configured to demand MORE than this (length, character classes), that check
// still runs server-side and its message is surfaced verbatim -- see
// describeAuthError's `weak_password` case.
export const PASSWORD_MIN_LENGTH = 8;

// Trim only, plus a lowercase fold. GoTrue lowercases the address it stores, so
// folding here means "Me@Example.com" and "me@example.com" are the same account
// in the UI as well as in the database -- otherwise signing up with one and
// signing in with the other looks like two different accounts to the player and
// like one to the server.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Deliberately shallow: something before an @, something after it, and at least
// one dot in the domain. A stricter regex here would only ever produce false
// rejections of addresses that are genuinely deliverable -- the authority on
// whether an address exists is the confirmation email, not this pattern.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

const EMAIL_MAX_LENGTH = 254; // RFC 5321's practical ceiling.

/** Returns a message to show the player, or null when the value is fine. */
export function validateEmail(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (!email) return "Enter your email address.";
  if (email.length > EMAIL_MAX_LENGTH) return "That email address is too long.";
  if (!EMAIL_SHAPE.test(email)) return "That doesn't look like an email address.";
  return null;
}

/**
 * For a password being CHOSEN (sign-up, reset). Never use this on the sign-in
 * form: an account created before this floor existed can hold a shorter
 * password, and "too short" is a confusing thing to say to someone whose real
 * problem is a typo -- sign-in only needs to know the field isn't empty.
 */
export function validateNewPassword(raw: string): string | null {
  if (!raw) return "Choose a password.";
  if (raw.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  return null;
}

// The GoTrue error codes worth answering in our own words. Everything else
// falls through to the server's message, which is usually fine and is always
// better than a generic "something went wrong" that hides a real reason.
//
// Each of these is a case where the raw string is either misleading in this
// app's context or actionable in a way only we know how to phrase:
//
// - `email_exists` / `user_already_exists`: the player is on the WRONG TAB.
//   That is the single most likely failure of the whole feature (a returning
//   player lands on a guest session, which opens on "Create account"), and
//   GoTrue's own wording says nothing about what to do next.
// - `invalid_credentials`: GoTrue deliberately won't say which half was wrong,
//   so its message is terse; make it read like a normal wrong-password.
// - `over_email_send_rate_limit`: on Supabase's built-in SMTP this fires after
//   a couple of emails an hour, and "email rate limit exceeded" reads like an
//   app bug rather than "wait a bit".
// - `same_password`: only reachable from the reset page.
const MESSAGES: Record<string, string> = {
  email_exists: "That email already has a DriverPit account. Switch to Sign in to use it.",
  user_already_exists: "That email already has a DriverPit account. Switch to Sign in to use it.",
  email_address_invalid: "Supabase rejected that email address. Try a different one.",
  invalid_credentials: "Wrong email or password.",
  email_not_confirmed: "Confirm your email first — check your inbox for the link we sent.",
  over_email_send_rate_limit: "Too many emails sent just now. Wait a few minutes and try again.",
  over_request_rate_limit: "Too many attempts just now. Wait a few minutes and try again.",
  same_password: "That's already your password. Choose a different one.",
  session_expired: "That link has expired. Request a new one.",
};

export interface AuthErrorLike {
  code?: string;
  message?: string;
}

export function describeAuthError(error: AuthErrorLike | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code];
  return error.message?.trim() || fallback;
}
