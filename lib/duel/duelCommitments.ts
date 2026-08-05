// The live server-side commitments this browser currently holds: a match it is
// inside, and/or a matchmaking queue row. Module-level rather than React
// context on purpose -- the consumer is AuthProvider.signOutAndReset(), which
// sits ABOVE /online in the tree and so can't read a context published by a
// duel component beneath it.
//
// Sign-out must RELEASE both before the session that authorizes them is torn
// down (an anonymous identity minted a moment later cannot forfeit a match the
// previous identity was playing). It's also what decides whether signing out
// needs a confirmation at all: with nothing in flight there's nothing at stake.
//
// Over-registering the match is deliberately harmless: duel_forfeit
// (drizzle/0026) never flips an already-terminal match, so a stale id forfeits
// nothing.
let liveMatchId: number | null = null;
let queued = false;
// The code of an OPEN custom lobby this browser is hosting. A third live
// commitment, and one with a second person on the other end of it: a friend who
// follows the link to a lobby whose host signed out joins a match nobody is in
// and eats a DISCONNECT_GRACE_MS forfeit for it. Cancelled in step 1 of
// signOutAndReset, while the outgoing identity can still authenticate the call.
let openLobbyCode: string | null = null;

export function setLiveMatchId(matchId: number | null): void {
  liveMatchId = matchId;
}

export function getLiveMatchId(): number | null {
  return liveMatchId;
}

// Set by DuelSearching for exactly as long as it holds a queue row.
export function setQueued(isQueued: boolean): void {
  queued = isQueued;
}

export function isQueued(): boolean {
  return queued;
}

// Set by CustomLobbyWaiting for exactly as long as it holds an open lobby --
// cleared the moment a joiner consumes it (that row belongs to a live match
// now, and the match commitment above takes over).
export function setOpenLobbyCode(code: string | null): void {
  openLobbyCode = code;
}

export function getOpenLobbyCode(): string | null {
  return openLobbyCode;
}

export interface DuelCommitments {
  matchLive: boolean;
  queued: boolean;
  hostingLobby: boolean;
}

// Whether signing out right now would abandon something -- drives the
// confirmation prompt.
export function getDuelCommitments(): DuelCommitments {
  return { matchLive: liveMatchId !== null, queued, hostingLobby: openLobbyCode !== null };
}
