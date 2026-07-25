const DEVICE_ID_KEY = "f1dw:deviceId";

// A stable identifier for this browser profile, deliberately keyed to the
// DEVICE rather than the session -- it must survive an identity swap, because
// the whole point is to recognise "this is the same person who was already
// queued" after they sign out and get a fresh anonymous user id.
//
// That is the one thing a self-match attacker can't shed by signing out, which
// is why match_or_queue refuses to pair two queue rows sharing it
// (drizzle/0032). Deliberate, accepted side effect: two different people
// sharing one browser profile cannot duel each other. That's a fair trade --
// it's indistinguishable from the attack at the server, and the workaround
// (a second browser or a private window) is trivial.
//
// Never sent anywhere but the matchmaking RPC, and it identifies a browser, not
// a person: no PII, and clearing site data simply mints a new one.
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    // Server render: there is no device yet. Callers only need this inside a
    // click/effect on the client, so returning empty here is safe -- and
    // match_or_queue rejects a blank device id outright rather than falling
    // back to the unguarded behaviour.
    return "";
  }
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Storage disabled/full (private mode, quota). Fall back to a per-session
    // id: still unique per browsing context, so the guard keeps working for
    // this session -- it just won't persist across reloads.
    return sessionDeviceId();
  }
}

let inMemoryDeviceId: string | null = null;

function sessionDeviceId(): string {
  if (!inMemoryDeviceId) inMemoryDeviceId = crypto.randomUUID();
  return inMemoryDeviceId;
}
