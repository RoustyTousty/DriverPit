import { useTranslations } from "next-intl";

import { MoreLink } from "./MoreLink";
import { ModeIcon, type GameModeId } from "./ModeIcon";

// Four, not five: Custom is a variant of Duel rather than a fifth thing to
// learn, so it earns its place on /game-modes and on /online -- where you can
// actually start one -- but not in the home page's summary, which exists to
// answer "what is there to play here?" in one glance.
//
// Shares `marketing.gameModes` with the full page, so a mode's name and one-line
// summary are written once and cannot say two different things in one language.
const MODES: { id: GameModeId; comingSoon?: boolean }[] = [
  { id: "daily" },
  { id: "infinite" },
  { id: "duel" },
  { id: "knockout", comingSoon: true },
];

export function GameModesTeaser() {
  const t = useTranslations("marketing.gameModes");

  return (
    <section id="game-modes" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">{t("heading")}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODES.map((mode) => (
          <div key={mode.id} className="flex gap-3 rounded-lg border border-border bg-surface-2 p-4">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-weak text-accent"
              aria-hidden="true"
            >
              <ModeIcon mode={mode.id} className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text">{t(`modes.${mode.id}.name`)}</span>
                {mode.comingSoon && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                    {t("comingSoon")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-text-muted">{t(`modes.${mode.id}.summary`)}</p>
            </div>
          </div>
        ))}
      </div>
      <MoreLink href="/game-modes">{t("teaserMore")}</MoreLink>
    </section>
  );
}
