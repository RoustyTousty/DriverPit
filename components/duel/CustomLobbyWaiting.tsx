"use client";

import { useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { getMyLiveMatch } from "@/lib/duel/actions";
import {
  cancelCustomLobby,
  customLobbyHeartbeat,
  getCustomLobbyState,
} from "@/lib/duel/customLobby";
import { setOpenLobbyCode } from "@/lib/duel/duelCommitments";
import { LOBBY_CHANNEL, MATCHED_EVENT, type MatchResult } from "@/lib/duel/matchmaking";
import { CUSTOM_LOBBY_HEARTBEAT_MS, CUSTOM_LOBBY_POLL_MS } from "@/lib/game/duelTiming";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// The host, waiting. Three jobs: show the code so it can be sent, stay alive,
// and notice the moment somebody joins.
//
// HOW THE JOIN IS NOTICED, and why it is not the broadcast's payload. The
// joiner broadcasts MATCHED_EVENT on the public `lobby` channel exactly as
// DuelSearching's joiner already does -- but that channel is deliberately public
// and deliberately non-authoritative, so the payload is treated as a TRIGGER
// only. On receiving it this calls duel_lobby_state(code) and takes the match id
// from there. It is a between-phases beat where a round trip costs nothing, and
// it means the host never renders profile data a stranger typed into a
// broadcast. Same rule the live match follows for round_end/match_end
// (drizzle/0050).
//
// A CUSTOM_LOBBY_POLL_MS poll backs the broadcast up, the same belt-and-braces
// as matchmaking's poll beside its own broadcast: a missed message costs a
// couple of seconds, not the game.
export function CustomLobbyWaiting({
  code,
  onMatchFound,
  onCancel,
}: {
  code: string;
  onMatchFound: (match: MatchResult) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Latest callback without re-subscribing the channel or restarting the poll
  // on every parent render.
  const foundRef = useRef(onMatchFound);
  foundRef.current = onMatchFound;
  // One resolution only: the poll and the broadcast race by design.
  const resolvedRef = useRef(false);

  const shareUrl = typeof window === "undefined" ? "" : `${window.location.origin}/online?join=${code}`;

  // Register the open lobby so signOutAndReset can cancel it in step 1, while
  // this identity can still authenticate the call. Cleared on unmount -- by
  // then this screen has either been cancelled or consumed by a joiner, and a
  // consumed lobby belongs to the match commitment instead.
  useEffect(() => {
    setOpenLobbyCode(code);
    return () => setOpenLobbyCode(null);
  }, [code]);

  // Liveness. 120s of slack (CUSTOM_LOBBY_STALE_MS) against a 20s beat, because
  // a backgrounded tab throttles this interval to roughly one call a minute and
  // the host is very likely to be in another tab pasting the code.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const beat = async () => {
      const alive = await customLobbyHeartbeat(code);
      // False means there is nothing left to beat -- consumed, cancelled or
      // swept. Stop rather than write forever; the poll below is what turns a
      // consumed lobby into a match.
      if (!cancelled && !alive) stop();
    };
    void beat();
    timer = setInterval(() => void beat(), CUSTOM_LOBBY_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [code]);

  // Resolve the lobby into a match. Shared by the broadcast handler and the
  // poll, and guarded so only the first one through wins.
  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (cancelled || resolvedRef.current) return;
      const state = await getCustomLobbyState(code);
      // matchId comes back only to the host or a participant -- we are the
      // host, so a non-null value here is the server's own word that the lobby
      // was consumed, not a stranger's.
      if (cancelled || !state || state.matchId === null || resolvedRef.current) return;

      // getMyLiveMatch builds the full MatchResult (opponent handle, avatar,
      // rating and record) off duel_matches through Drizzle, which is where the
      // joiner's real profile lives -- rather than off anything they sent.
      const live = await getMyLiveMatch();
      if (cancelled || resolvedRef.current) return;
      if (!live.ok || !live.match || live.match.matchId !== state.matchId) return;

      resolvedRef.current = true;
      setOpenLobbyCode(null);
      foundRef.current(live.match);
    }

    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(LOBBY_CHANNEL);
    channel
      // The payload is not read. Its arrival is the only information taken from
      // it -- everything rendered comes from the two authenticated reads above.
      .on("broadcast", { event: MATCHED_EVENT }, () => void resolve())
      .subscribe();

    const poll = setInterval(() => void resolve(), CUSTOM_LOBBY_POLL_MS);
    void resolve();

    return () => {
      cancelled = true;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [code]);

  // Both copy paths confirm the SAME way the daily share does
  // (DailyGame: toast.success("Copied to clipboard")) -- a clipboard write is
  // silent and invisible, and on the code itself there is no button label to
  // flip, so without the toast a click looks like it did nothing at all.
  async function copy(what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(what === "code" ? code : shareUrl);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
      toast.success(what === "code" ? "Code copied to clipboard" : "Link copied to clipboard");
    } catch {
      // Clipboard access can be denied outright, and the code is on screen and
      // readable anyway -- say so rather than failing silently.
      toast.error("Couldn't copy — select the code and copy it manually.");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "DriverPit", text: `Play me on DriverPit — code ${code}`, url: shareUrl });
    } catch {
      // Includes the user simply dismissing the sheet, which is not an error.
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelCustomLobby(code);
      setOpenLobbyCode(null);
      onCancel();
    } catch {
      // The lobby goes stale on its own within CUSTOM_LOBBY_STALE_MS, so a
      // failed cancel is not a trap -- but leaving the player stuck on this
      // screen would be.
      setCancelling(false);
      toast.error("Couldn't cancel the lobby — it will expire on its own shortly.");
    }
  }

  return (
    // Deliberately down to five things: what is happening, the code, the two
    // ways to send it, and a way out. The config and pool readout that used to
    // sit under the buttons was a summary of choices made 10 seconds earlier on
    // the previous screen, and nothing here can act on it -- changing the game
    // means cancelling anyway. One level of elevation throughout: the window is
    // bg-surface and everything interactive on it is bg-surface-2 + border.
    <div className="flex flex-col items-center gap-6 px-4 py-8 text-center">
      <div className="flex flex-col items-center gap-1.5">
        {/* The spinner rides WITH the heading, because the heading is the thing
            that is in progress. At the bottom of the screen it was a second,
            competing statement of the same fact, below the fold on a phone. */}
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-bold text-text">Waiting for your opponent</h1>
          <Spinner />
        </div>
        <p className="text-sm text-text-muted">
          Send them the code and they will drop straight in.
        </p>
      </div>

      {/* THE CODE IS THE BUTTON. Copying it is the only thing anyone wants from
          this screen, so the largest target on it does that rather than sitting
          inert beside a smaller control that does. Still real text -- readable
          aloud over a call, and `select-all` keeps a drag-select working for
          anyone who prefers it. */}
      <button
        type="button"
        onClick={() => void copy("code")}
        // Fixed regardless of the copied state, so the control does not rename
        // itself under a screen-reader user mid-read. The toast is what
        // announces the result; the tick below is its visual twin.
        aria-label={`Game code ${code.split("").join(" ")}. Copy to clipboard`}
        className="group flex w-full flex-col items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-6 transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-safe:active:scale-[0.99]"
      >
        <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
          Game code
        </span>
        <span
          aria-hidden="true"
          className="font-mono text-4xl font-bold tracking-[0.35em] tabular-nums text-accent select-all"
        >
          {/* The trailing letter-spacing would otherwise push the string
              visibly off-centre inside a centred container. */}
          <span className="-mr-[0.35em]">{code}</span>
        </span>
        {/* A tick rather than the word "Copied": it is the same statement in a
            glyph, it needs no translation, and it keeps the screen quiet. Fixed
            height so the swap cannot shift the code above it. */}
        <span className="flex h-4 items-center text-xs text-text-muted transition group-hover:text-text">
          {copied === "code" ? <CheckMark /> : "Click to copy"}
        </span>
      </button>

      <div className="flex w-full gap-2">
        <button
          type="button"
          onClick={() => void copy("link")}
          // Same reason as the code button's: the label swaps to a glyph, so the
          // accessible name has to come from here or it would vanish on copy.
          aria-label="Copy link"
          className="flex flex-1 items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.98]"
        >
          {copied === "link" ? <CheckMark /> : "Copy link"}
        </button>
        {/* Only where the platform actually has a share sheet -- on desktop
            Chrome this is absent, and a button that opens nothing is worse than
            no button. Border-only, like every other secondary button on the
            site (GeneralSection's "Reset stats", DriverFilterModal's Cancel). */}
        {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
          <button
            type="button"
            onClick={() => void share()}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Share
          </button>
        )}
      </div>

      {/* The duel's one "leave this screen" shape, verbatim: full width, the
          same padding, radius and muted weight as Cancel while searching, Back
          to modes on the results panel, and Exit match mid-duel. It was the
          only one of the five rendered as bare auto-width text, so it sat
          narrow and unaligned under the two full-width controls directly above
          it. Backing out of a duel should look the same wherever you do it.
          `disabled:opacity-50` is the one addition -- this is the only one of
          the five that awaits a server call before it can leave. */}
      <button
        type="button"
        onClick={() => void handleCancel()}
        disabled={cancelling}
        className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {cancelling ? "Cancelling…" : "Cancel game"}
      </button>
    </div>
  );
}

// Purely visual confirmation -- aria-hidden, because the toast that fires with
// it already carries the announcement through the live region, and a screen
// reader hearing "checkmark" adds nothing to "Code copied to clipboard".
function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
