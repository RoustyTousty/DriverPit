import Link from "next/link";

const LINK_CLASS =
  "font-medium text-text underline decoration-border underline-offset-2 hover:text-accent";

// The full About page. It is about the PROJECT: what it is, what you can play,
// who makes it and how it stays free. Where the driver rows come from is an
// implementation detail, and an About section is not where anyone goes looking
// for it -- that disclosure lives in the terms and the privacy policy, which is
// also where it does real work.
export function AboutSection() {
  return (
    <section id="about" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">About DriverPit</h2>

      <p className="text-sm text-text-muted">
        DriverPit is a Formula 1 guessing game. There&rsquo;s one mystery driver a day, the same one for everyone,
        and six guesses to find them — every guess you make comes back compared against the answer on five things:
        nationality, team, age, debut year and career wins. No trivia questions, no multiple choice. You narrow it
        down.
      </p>

      <p className="text-sm text-text-muted">
        It started as a simple idea — Wordle, but the answer is a driver — and grew into four ways to play.{" "}
        <span className="font-semibold text-text">Daily</span> is the one puzzle everyone shares.{" "}
        <span className="font-semibold text-text">Infinite</span> is unlimited practice over a grid you compose
        yourself: any span of seasons, narrowed by nationality, team, or what a driver actually won.{" "}
        <span className="font-semibold text-text">Duel</span> puts you against a real opponent in a live three-round
        race where speed scores points and you can watch them closing in. And a{" "}
        <span className="font-semibold text-text">Custom</span> game is that same duel hosted by a code, so you can
        send it to a friend and set the rules yourself. See{" "}
        <Link href="/how-to-play" className={LINK_CLASS}>
          How to play
        </Link>{" "}
        for the rules and{" "}
        <Link href="/game-modes" className={LINK_CLASS}>
          Game modes
        </Link>{" "}
        for what each one offers.
      </p>

      <p className="text-sm text-text-muted">
        It&rsquo;s built and maintained by one independent developer — a passion project for people who like F1
        trivia and word games in equal measure, not a commercial product. That shapes what it is: free to play with
        no paywall and no premium tier, playable without an account (making one only carries your streak between
        devices and puts you on the leaderboard), and answerable to nobody about which features come next.
      </p>

      <p className="text-sm text-text-muted">
        Running it isn&rsquo;t free, though, and nothing here is sponsored. If DriverPit has become part of your
        morning and you&rsquo;d like to keep it going, you can{" "}
        <a href="https://buymeacoffee.com/ecozo" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          buy me a coffee
        </a>
        . Entirely optional — the game is exactly the same either way.
      </p>

      <p className="text-xs text-text-muted">
        DriverPit is an independent fan project. It isn&apos;t affiliated with, endorsed by, or connected to Formula
        1, the FIA, or any team or driver named in the game.
      </p>
    </section>
  );
}
