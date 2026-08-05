import { MoreLink } from "./MoreLink";

// About the PROJECT, not about the dataset behind it. The provenance of the
// driver rows is an implementation detail nobody arrives at a game's About
// section to read -- it belongs in the terms, where it is a real disclosure,
// and it stays there.
export function AboutTeaser() {
  return (
    <section id="about" className="flex flex-col gap-3">
      <h2 className="text-2xl font-bold text-text">About DriverPit</h2>
      <p className="text-sm text-text-muted">
        A daily Formula 1 guessing game, built and run by one person as a side project. Free to play, no account
        needed, and an independent fan project — not affiliated with F1, the FIA, or any team.
      </p>
      <MoreLink href="/about">More about DriverPit</MoreLink>
    </section>
  );
}
