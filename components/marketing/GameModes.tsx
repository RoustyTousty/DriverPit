import { useTranslations } from "next-intl";

import { ModeIcon, type GameModeId } from "./ModeIcon";

// Summaries are one clause per fact, in the same clipped register the home
// teaser and the /online mode select use. Custom is last: it is a variant of
// Duel rather than a fifth way to play, and reading it after Duel is what makes
// "the same match, on your terms" land.
//
// This page is also where the guess-decay rule is explained in full. It used to
// be a line on /online as well, which was the wrong place for it -- a landing
// screen is where you choose a mode, not where you learn its scoring, and the
// rule is surfaced where it actually applies: live in the match, as the "Solve
// now +N" figure and the "×0.88 on a solve" caption.
//
// ORDER AND SHAPE LIVE HERE; the prose lives in messages/*.json. `points` is the
// number of bullets, not the bullets themselves -- a translator rewording a line
// must not be able to add or drop one, because the count is what the layout and
// the mode's own argument depend on.
const MODES: { id: GameModeId; points: number; comingSoon?: boolean }[] = [
  { id: "daily", points: 5 },
  { id: "infinite", points: 5 },
  { id: "duel", points: 7 },
  { id: "knockout", points: 4, comingSoon: true },
  { id: "custom", points: 5 },
];

export function GameModes() {
  const t = useTranslations("marketing.gameModes");

  return (
    <section id="game-modes" className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-text">{t("heading")}</h2>
      <div className="flex flex-col gap-4">
        {MODES.map((mode) => (
          <div key={mode.id} className="rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-weak text-accent"
                aria-hidden="true"
              >
                <ModeIcon mode={mode.id} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-text">{t(`modes.${mode.id}.name`)}</span>
                  {mode.comingSoon && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                      {t("comingSoon")}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-text-muted">{t(`modes.${mode.id}.summary`)}</p>
              </div>
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
              {Array.from({ length: mode.points }, (_, index) => index + 1).map((point) => (
                <li key={point} className="flex gap-2 text-sm text-text-muted">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
                  {t(`modes.${mode.id}.points.${point}`)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
