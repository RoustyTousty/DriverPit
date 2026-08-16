"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useAuthIdentity } from "@/components/auth/AuthProvider";
import { DriverFilterSummary } from "@/components/game/DriverFilterSummary";
import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import {
  LOBBY_CODE_LENGTH,
  getCustomLobbyState,
  isCompleteLobbyCode,
  joinCustomLobby,
  normalizeLobbyCode,
  type CustomLobbyState,
} from "@/lib/duel/customLobby";
import { LOBBY_CHANNEL, MATCHED_EVENT, type MatchResult } from "@/lib/duel/matchmaking";
import type { DriverWithActivity } from "@/lib/db/queries";
import { describeMatchConfig } from "@/lib/game/customMatchConfig";
import { matchesDriverFilter } from "@/lib/game/driverFilter";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { RatingBadge } from "./DuelMatchFound";

// The joiner. Type or paste a code, see who and what you are about to join,
// then join.
//
// THE PREVIEW IS THE POINT of this being two steps rather than one. A code
// arrives out of band -- read over a call, forwarded twice in a group chat --
// and joining is irreversible: it consumes the lobby, so getting it wrong burns
// somebody else's game. Showing the host's handle and the match's shape first
// costs one read (duel_lobby_state, which deliberately withholds the match id
// from a non-participant) and makes "is this the right one?" answerable.
export function CustomLobbyJoin({
  allDrivers,
  initialCode,
  referenceYear,
  onMatchFound,
}: {
  // Only to COUNT the host's pool for the preview -- the joiner sees the same
  // "1994 - Ferrari / 12 drivers" line the host composed against, rather than a
  // description whose size they have to guess at. Same roster /online already
  // ships for the filter panel, so this costs nothing.
  allDrivers: DriverWithActivity[];
  // From the ?join= deep link, if there was one. Pre-fills the box and kicks
  // off the preview; it deliberately does NOT auto-join -- see above.
  initialCode?: string;
  referenceYear: number;
  onMatchFound: (match: MatchResult) => void;
}) {
  const { ensureIdentity } = useAuthIdentity();
  const [code, setCode] = useState(() => normalizeLobbyCode(initialCode ?? ""));
  const [preview, setPreview] = useState<CustomLobbyState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const foundRef = useRef(onMatchFound);
  foundRef.current = onMatchFound;

  const complete = isCompleteLobbyCode(code);

  // Fetch the preview as soon as the code is complete, and drop it the moment
  // it stops being -- a preview of the code someone just backspaced out of is
  // worse than none.
  useEffect(() => {
    if (!complete) {
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    void getCustomLobbyState(code).then((state) => {
      if (cancelled) return;
      setPreviewing(false);
      setPreview(state);
      // duel_lobby_state returns nothing for both a wrong code and an expired
      // lobby, on purpose -- so this message covers both rather than claiming
      // to know which.
      setError(state === null ? "No open game with that code." : null);
    });
    return () => {
      cancelled = true;
    };
  }, [code, complete]);

  async function handleJoin() {
    if (!preview) return;
    setJoining(true);
    setError(null);

    // duel_lobby_join authorizes through auth.uid(). The likeliest arrival here
    // is a shared link opened cold (/online?join=CODE), which is exactly the
    // visitor who has no identity yet (roadmap Pass 4a).
    if (!(await ensureIdentity())) {
      setJoining(false);
      setError("Couldn't reach the server. Check your connection and try again.");
      return;
    }

    const result = await joinCustomLobby(code, preview.rounds);
    if (!result.ok) {
      setJoining(false);
      // The RPC's own messages are written to be read ("You cannot join your
      // own lobby", "That lobby has expired"), and each names a different thing
      // to do about it -- so they are surfaced rather than flattened.
      setError(result.error);
      return;
    }

    // Tell the host, on the same public `lobby` channel DuelSearching's joiner
    // uses. Deliberately payload-free beyond naming the host: they re-read the
    // lobby and the match server-side rather than trusting anything here, so
    // this is a doorbell, not data. Their CUSTOM_LOBBY_POLL_MS poll covers a
    // dropped message.
    try {
      const supabase = createSupabaseBrowserClient();
      const channel = supabase.channel(LOBBY_CHANNEL);
      await channel.subscribe();
      await channel.send({
        type: "broadcast",
        event: MATCHED_EVENT,
        payload: { forUserId: preview.hostId, matchId: result.match.matchId },
      });
      void supabase.removeChannel(channel);
    } catch {
      // Best effort. The host's poll resolves it within CUSTOM_LOBBY_POLL_MS
      // regardless, so a failed broadcast costs a beat and nothing else.
    }

    foundRef.current(result.match);
  }

  // Counted through the same predicate the host used and the SQL mirrors, so
  // the number the joiner reads is the set the rounds are actually drawn from.
  const previewCount = useMemo(
    () => (preview ? allDrivers.filter((driver) => matchesDriverFilter(driver, preview.filter)).length : 0),
    [allDrivers, preview],
  );

  const hostHandle = preview ? preview.hostDisplayName || preview.hostUsername : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label
          htmlFor="lobby-code"
          className="text-xs font-semibold tracking-wide text-text-muted uppercase"
        >
          Game code
        </label>
        {/* Normalized on every keystroke rather than validated on submit: the
            box shows exactly what will be sent, so a pasted "abc-123" visibly
            becomes ABC123 instead of being silently reinterpreted later.
            autoCapitalize/autoCorrect off because a mobile keyboard will
            otherwise "helpfully" rewrite a six-character nonsense word.

            The placeholder holds only characters the alphabet actually
            contains -- no 0/1/I/L/O. "ABC123" was the first draft and is
            impossible: it advertises a shape no generated code can have.

            NO maxLength, deliberately. It bounds the RAW value, before
            normalizeLobbyCode has stripped anything -- so pasting "ABC-234"
            (seven characters) truncates to "ABC-23" and normalizes to a
            five-character "ABC23", silently losing the last character of a
            perfectly good code. The dashed form is exactly what a shared code
            looks like. normalizeLobbyCode slices to length AFTER stripping,
            which is the only order that works. */}
        <input
          id="lobby-code"
          value={code}
          onChange={(event) => setCode(normalizeLobbyCode(event.target.value))}
          // The only control on this panel, and the person arrived here to use
          // it -- including from a deep link, where the code is already in the
          // box and the caret should be at its end ready to correct a typo.
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          placeholder="ABC234"
          aria-describedby="lobby-code-status"
          aria-invalid={error !== null}
          className={`w-full rounded-lg border bg-surface-2 px-4 py-4 text-center font-mono text-3xl tracking-[0.3em] tabular-nums text-text uppercase transition placeholder:text-text-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            // The field answers "is this a code yet?" on its own, so the
            // disabled Join button is never the only signal. Red only once a
            // complete code has actually been rejected -- a half-typed one is
            // incomplete, not wrong, and colouring it red while someone is
            // still typing is just nagging.
            // Hover lifts the neutral border to accent, matching the guess
            // input and /online's mode rows. Only in the neutral state: red is
            // a verdict and shouldn't be overwritten by a cursor, and a
            // complete code is already accent.
            error !== null
              ? "border-red-400/60"
              : complete
                ? "border-accent"
                : "border-border hover:border-accent"
          }`}
        />
        {/* ONE status line, always present, always exactly one line high.
            The hint, the lookup and the error are three mutually-exclusive
            answers to the same question -- "what is going on with this code?" --
            and they used to be three separately-mounted blocks, so a wrong code
            INSERTED a paragraph and pushed the preview, the button and the rest
            of the page down as you typed the sixth character. Reserving the line
            costs 20px of always-blank space in the best case and removes the
            whole class of shift. role="alert" is on the element from first
            render (never mounted alongside the message) so the live region is
            already registered when the text lands, which is what makes it
            actually announce. */}
        <p
          id="lobby-code-status"
          role="alert"
          className={`flex min-h-5 items-center justify-center text-center text-xs ${
            error !== null ? "text-red-400" : "text-text-muted"
          }`}
        >
          {error ??
            (previewing
              ? "Looking up that code…"
              : // Says the two things a person needs: how long it is, and that
                // pasting the whole link works -- which is what they will have,
                // since "Copy link" is the host's primary button.
                `${LOBBY_CODE_LENGTH} characters. You can paste the whole link.`)}
        </p>
      </div>

      {preview && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-center gap-3">
            <AvatarGlyph avatarUrl={preview.hostAvatarUrl} size="sm" />
            <div className="flex min-w-0 flex-col items-start">
              <span className="truncate text-sm font-semibold text-text">{hostHandle}</span>
              <span className="text-xs text-text-muted">is waiting for you</span>
            </div>
            <div className="ml-auto">
              <RatingBadge rating={preview.hostRating} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <p className="font-mono text-xs tabular-nums text-text-muted">
              {describeMatchConfig({ rounds: preview.rounds, roundSeconds: preview.roundSeconds })}
            </p>
            {/* The same caption the host composed against, so what is being
                joined is described in exactly the words it was created in. */}
            <DriverFilterSummary
              filter={preview.filter}
              matchCount={previewCount}
              referenceYear={referenceYear}
            />
            {/* Said plainly, before joining rather than after: a friendly game
                is the whole proposition, and someone who wanted a rated one
                should find that out here. */}
            <span className="text-xs text-text-muted">
              Unranked · nothing counts toward your rating
            </span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleJoin()}
        disabled={!complete || preview === null || joining}
        className="w-full rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.98] disabled:opacity-50"
      >
        {/* Deliberately NOT "Join {hostHandle}" once the preview lands. The
            host's name is already on screen directly above, and a button whose
            accessible name changes under a screen-reader user mid-read is worse
            than a static one that says what it does. */}
        {joining ? "Joining…" : "Join game"}
      </button>
    </div>
  );
}
