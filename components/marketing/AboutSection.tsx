export function AboutSection() {
  return (
    <section id="about-drivers" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">About the drivers</h2>

      <p className="text-sm text-text-muted">
        Every driver in the game comes from{" "}
        <a
          href="https://github.com/f1db/f1db"
          className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent"
        >
          F1DB
        </a>
        , an open, community-maintained Formula 1 database — every driver who has ever started a
        Grand Prix, from the 1950 season to the current grid. Not all of them are in play at once,
        though: which drivers can turn up as the mystery driver (or show up as autocomplete
        suggestions) is controlled by a <span className="font-semibold text-text">driver pool</span>,
        based on how recently they last raced. The Daily and Duel puzzles always draw from{" "}
        <span className="font-semibold text-text">Regular</span> — anyone who has started a race in
        the last 10 seasons. Infinite mode lets you pick the pool yourself, from{" "}
        <span className="font-semibold text-text">Amateur</span> (this season only) up through{" "}
        <span className="font-semibold text-text">Legend</span> (the entire history of the sport).
      </p>

      <p className="text-sm text-text-muted">
        Each guess is compared across five attributes, shown as five tiles next to the guessed
        driver&apos;s F1DB code. Nationality is exact-match only. Team has three states: green if
        it&apos;s the mystery driver&apos;s current constructor, a dim orange if it&apos;s a team they&apos;ve
        raced for at some point in their career, or grey if there&apos;s no relation at all. Age, debut
        year, and career wins are numeric — a miss also reveals whether the mystery driver&apos;s value
        is higher or lower than your guess, and the tile shades toward orange the closer your number
        was, so a near-miss looks noticeably different from a wild guess. Wins count every race win
        across a driver&apos;s career, debut year is their first Grand Prix start, and age is
        calculated as of today — or at the time of death, for drivers who have since passed away.
      </p>

      <p className="text-sm text-text-muted">
        The daily puzzle is picked from the Regular pool in advance and locks in at 00:00 UTC for
        everyone, worldwide, so your daily driver is the same one everyone else gets that day,
        regardless of time zone. Behind the scenes, win totals and current teams are refreshed
        weekly from live results, so the numbers you&apos;re comparing against stay accurate as a
        season plays out.
      </p>

      <p className="text-xs text-text-muted">
        DriverPit is an independent fan project. It isn&apos;t affiliated with, endorsed by, or
        connected to Formula 1, the FIA, or any team or driver named in the game.
      </p>
    </section>
  );
}
