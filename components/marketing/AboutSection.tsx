import Link from "next/link";

export function AboutSection() {
  return (
    <section id="about" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">About DriverPit</h2>

      <p className="text-sm text-text-muted">
        DriverPit is a daily guessing game for Formula 1 fans — the same idea as Wordle, but every
        guess compares a real driver across five attributes instead of letters: nationality, team,
        age, debut year, and career wins. Guess who the mystery driver is in six tries, or race a
        matchmade opponent to the same driver in Duel mode. See{" "}
        <Link href="/how-to-play" className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent">
          How to play
        </Link>{" "}
        for the full rules and{" "}
        <Link href="/game-modes" className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent">
          Game modes
        </Link>{" "}
        for what each one offers.
      </p>

      <p className="text-sm text-text-muted">
        Every driver comes from{" "}
        <a
          href="https://github.com/f1db/f1db"
          className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent"
        >
          F1DB
        </a>
        , an open, community-maintained Formula 1 database covering every Grand Prix starter since
        1950. Not all of them are in play at once, though — which drivers can turn up as the mystery
        driver is controlled by a <span className="font-semibold text-text">driver pool</span> based
        on how recently they last raced, from this season only up to the sport&apos;s entire history.
        Behind the scenes, win totals and current teams are refreshed weekly from live results, so
        the numbers you&apos;re comparing against stay accurate as a season plays out.
      </p>

      <p className="text-sm text-text-muted">
        DriverPit is built and maintained by an independent solo developer — a passion project for
        people who like F1 trivia and word games in equal measure, not a commercial product.
      </p>

      <p className="text-xs text-text-muted">
        DriverPit is an independent fan project. It isn&apos;t affiliated with, endorsed by, or
        connected to Formula 1, the FIA, or any team or driver named in the game.
      </p>
    </section>
  );
}
