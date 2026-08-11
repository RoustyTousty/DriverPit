import { useTranslations } from "next-intl";
import type { DriverPage } from "@/lib/db/dailyRecap";
import { formatCount } from "@/lib/recap/format";

// The career record, as the five numbers the game itself compares on plus the
// three achievement totals Infinite's filter uses. Nothing here is site-unique
// -- it is F1DB's, and it is the CONTEXT a reader needs rather than the reason
// the page exists (see lib/drivers/pageEligibility.ts for what that reason is).
//
// Deliberately a definition list and not the board's Tile row. AnswerBoardRow
// renders an archive day's answer as the row a solver saw, which is a statement
// about that day; this is a driver's record, which is not a guess and has no
// verdict attached. Reusing the tiles would say "every one of these was exact"
// about a comparison nobody made.

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <dt className="text-xs tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className="font-mono text-2xl leading-none font-bold tabular-nums text-text">{value}</dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-right text-sm font-semibold text-text">{value}</dd>
    </div>
  );
}

export function DriverCareer({ driver }: { driver: DriverPage }) {
  const t = useTranslations("driverPage.career");
  const seasons =
    driver.debutYear === driver.lastActiveYear
      ? String(driver.debutYear)
      : `${driver.debutYear}–${driver.lastActiveYear}`;

  return (
    <div className="flex flex-col gap-6">
      {/* The four counts worth reading at a glance. Wins first because it is the
          column the game compares on, so it is the number a player arriving
          from a board is looking for. */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("wins")} value={formatCount(driver.careerWins)} />
        <Stat label={t("podiums")} value={formatCount(driver.podiums)} />
        <Stat label={t("poles")} value={formatCount(driver.polePositions)} />
        <Stat label={t("titles")} value={formatCount(driver.championshipWins)} />
      </dl>

      <dl className="flex flex-col rounded-lg border border-border bg-surface px-4 py-2">
        {/* Nationality as text, for the same reason AnswerBoardRow spells it
            out: this page is the record, and a background-image flag class puts
            the country somewhere only a tooltip can read it. */}
        <Fact label={t("nationality")} value={driver.nationality} />
        {/* "Age at death" rather than a silently frozen age: the board compares
            on age at death for a driver who has died (the same rule
            compare_drivers uses), and a page that just says "Age 44" about
            somebody who died in 1994 is stating it as a current fact. */}
        <Fact label={driver.dateOfDeath ? t("ageAtDeath") : t("age")} value={String(driver.age)} />
        <Fact label={t("seasons")} value={seasons} />
        {driver.lastTeam && <Fact label={t("lastTeam")} value={driver.lastTeam} />}
        {driver.driverCode && <Fact label={t("code")} value={driver.driverCode} />}
      </dl>
    </div>
  );
}
