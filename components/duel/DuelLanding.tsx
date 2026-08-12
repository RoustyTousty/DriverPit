"use client";

import { useTranslations } from "next-intl";

import { useAuth } from "@/components/auth/AuthProvider";
import { GuestUpgradePrompt } from "@/components/auth/GuestUpgradePrompt";
import { ModeIcon, type GameModeId } from "@/components/marketing/ModeIcon";

// Three stacked rows rather than three tall cards. The old cards each carried a
// two-to-three-line description at `text-sm`, so choosing a mode meant reading
// ~60 words of prose about modes most players already know -- and on a phone
// the third one started below the fold, which is a poor way to advertise that
// Custom exists.
//
// The row is GameModesTeaser's card, which is the app's existing dense
// mode-list shape: accent-weak well + accent ModeIcon, `text-sm font-bold`
// name, one `text-xs text-text-muted` line. So /online and /game-modes now show
// the same modes with the same icons in the same shape, and the chevron is the
// only thing added -- it is what makes a row read as "go here" rather than as a
// description.
//
// The one-liners describe the SHAPE OF THE CONTEST, not the plumbing: "race a
// matchmade opponent across 3 rounds" led with how you get an opponent, which
// is the part a player has no decision to make about. They are also the same
// strings, in the same register, as /game-modes and the home teaser.
//
// Nothing here explains scoring. This screen's job is to get someone into a
// mode; the rules -- including guess decay, which used to sit under these rows
// as a fourth block of text -- live on /game-modes, one footer link away, and
// are surfaced *inside* a match where they actually apply (the "Solve now +N"
// figure and the "×0.88 on a solve" caption).
interface ModeRow {
  id: GameModeId;
  name: string;
  summary: string;
  // Rendered inert, with a tag instead of a chevron. Not "disabled": there is
  // no button here to disable, because there is nowhere for it to go.
  comingSoon?: boolean;
  onSelect?: () => void;
}

const CHEVRON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    className="h-4 w-4 shrink-0 text-text-muted transition group-hover:text-text"
    aria-hidden="true"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

function ModeWell({ mode }: { mode: GameModeId }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-weak text-accent"
      aria-hidden="true"
    >
      <ModeIcon mode={mode} className="h-4.5 w-4.5" />
    </span>
  );
}

export function DuelLanding({
  onSelectDuel,
  onSelectCustom,
}: {
  onSelectDuel: () => void;
  // Optional so LoadingShell can render this screen inert without inventing a
  // second no-op handler.
  onSelectCustom?: () => void;
}) {
  const modeNames = useTranslations("nav.modes");
  const { profile } = useAuth();

  // Custom last, matching /game-modes: it is a variant of Duel rather than a
  // third way to play, and it reads as one when it follows the headline mode
  // instead of being split from it.
  //
  // KNOCKOUT'S ROW IS GONE (2026-08-12). It sat between these two as a disabled
  // "coming soon" card, and `/online` is an indexed page whose server-rendered
  // HTML is exactly this list -- so it was an advertised mode that does not
  // exist on a page a crawler reads, which is the "links to content that does
  // not exist" clause AdSense rejected the site under. The `comingSoon` branch
  // below is deliberately kept: it is how the row comes back when the mode is
  // real but not yet enabled, and re-deriving it later is how a disabled
  // control ends up as an enabled one that hosts a duel wearing a Knockout
  // label. See lib/game/onlineModes.ts for why that specific mistake is
  // unrepresentable at the database level.
  const modes: ModeRow[] = [
    { id: "duel", name: "Duel", summary: "1v1, one target, 3 rounds — highest score wins.", onSelect: onSelectDuel },
    { id: "custom", name: "Custom", summary: "The same match, by invite, on your terms.", onSelect: onSelectCustom },
  ];

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      {/* The same stacked header Daily and Infinite use -- brand on top, mode
          underneath, reading the mode name from `nav.modes` so the subtitle and
          the tab cannot disagree. It was a single "Play online" line, which made
          the one mode that is not a board look like a different kind of page. */}
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">{modeNames("online")}</p>
      </header>

      {profile?.isGuest && (
        <GuestUpgradePrompt
          description="Create an account so your stats and streak follow you across devices."
          next="/online"
        />
      )}

      <div className="flex flex-col gap-2">
        {modes.map((mode) =>
          mode.comingSoon ? (
            // cursor-not-allowed on a plain div: it is the only hover feedback
            // an unavailable row gets, and without it the pointer stays a plain
            // arrow, which says nothing either way. No chevron -- there is
            // nowhere to go.
            <div
              key={mode.id}
              className="flex cursor-not-allowed items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left opacity-60"
            >
              <ModeWell mode={mode.id} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-bold text-text">{mode.name}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                    Coming soon
                  </span>
                </span>
                <span className="block text-xs text-text-muted">{mode.summary}</span>
              </span>
            </div>
          ) : (
            <button
              key={mode.id}
              type="button"
              onClick={mode.onSelect}
              className="group flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 text-left transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ModeWell mode={mode.id} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-text">{mode.name}</span>
                <span className="block text-xs text-text-muted">{mode.summary}</span>
              </span>
              {CHEVRON}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
