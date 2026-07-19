import { MoreLink } from "./MoreLink";

export function AboutTeaser() {
  return (
    <section id="about" className="flex flex-col gap-3">
      <h2 className="text-2xl font-bold text-text">About DriverPit</h2>
      <p className="text-sm text-text-muted">
        Every driver comes from{" "}
        <a
          href="https://github.com/f1db/f1db"
          className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent"
        >
          F1DB
        </a>
        , an open Formula 1 database covering every Grand Prix starter since 1950. DriverPit is an
        independent fan project, not affiliated with F1, the FIA, or any team.
      </p>
      <MoreLink href="/about">More about DriverPit</MoreLink>
    </section>
  );
}
