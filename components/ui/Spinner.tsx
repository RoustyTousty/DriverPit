// THE loading circle, shared by every "waiting on the server" beat in the app:
// the duel lobby's opponent search, the pre-round countdown before
// duel_begin_round resolves, and the daily/infinite board load overlay
// (components/game/LoadingOverlay.tsx). Same reasoning as GuessGrid's
// PendingGuessRow being the one shimmer -- a second hand-rolled copy is how two
// spinners end up with different border weights and speeds.
//
// Motion: `motion-reduce:` freezes this to a static ring under the OS
// prefers-reduced-motion setting. Nothing extra to do per-call-site.
// `sm` is sized to sit in DuelSearching's VS slot: roughly the width of the
// bold "VS" glyph that replaces it the moment an opponent lands, so the two
// avatar columns either side don't shift when the searching screen hands off to
// the staging screen.
const SIZES = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
} as const;

export type SpinnerSize = keyof typeof SIZES;

export function Spinner({ size = "sm" }: { size?: SpinnerSize }) {
  return (
    <span
      className={`block ${SIZES[size]} animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none`}
      aria-hidden="true"
    />
  );
}
