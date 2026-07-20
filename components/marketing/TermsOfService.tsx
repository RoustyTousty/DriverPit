const LAST_UPDATED = "July 2026";

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Agreement",
    body: (
      <p className="text-sm text-text-muted">
        By playing DriverPit, you agree to these terms. If you don't agree, you're welcome to not
        use the site — there's no account required to try it, and no obligation to keep one.
      </p>
    ),
  },
  {
    title: "The service",
    body: (
      <p className="text-sm text-text-muted">
        DriverPit is a free, independently-run Formula 1 guessing game. It isn't affiliated with,
        endorsed by, or connected to Formula 1, the FIA, or any team or driver named in the game.
        Driver data comes from{" "}
        <a
          href="https://github.com/f1db/f1db"
          className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent"
        >
          F1DB
        </a>
        , an open, community-maintained database.
      </p>
    ),
  },
  {
    title: "Accounts",
    body: (
      <div className="flex flex-col gap-2 text-sm text-text-muted">
        <p>
          You can play Daily, Infinite, and Duel as an anonymous guest, with no sign-up. Creating a
          full account (email or Google) is only required to appear on the leaderboard or set a
          custom profile. You're responsible for keeping your account secure and for anything that
          happens under it.
        </p>
        <p>
          You must be at least 13 years old to create an account. If we learn an account belongs to
          someone younger, we'll remove it.
        </p>
      </div>
    ),
  },
  {
    title: "Acceptable use",
    body: (
      <ul className="flex flex-col gap-1.5 text-sm text-text-muted">
        {[
          "No automating guesses, scripting matchmaking, or otherwise using bots or tools to gain an unfair advantage in Duel or on the leaderboard.",
          "No harassment, hate speech, or abuse directed at other players, including through usernames or display names.",
          "No attempting to disrupt the service — matchmaking, the database, or the site itself — for other players.",
          "No scraping or reselling the driver data served by the game.",
        ].map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    ),
  },
  {
    title: "Usernames and profiles",
    body: (
      <p className="text-sm text-text-muted">
        Your username, display name, and avatar are visible to other players in Duel and on the
        leaderboard. Don't impersonate anyone or use offensive names — we can rename or suspend an
        account that does.
      </p>
    ),
  },
  {
    title: "Advertising",
    body: (
      <p className="text-sm text-text-muted">
        DriverPit is supported by ads served through Google AdSense, shown outside of active
        matches. See our{" "}
        <a
          href="/privacy-policy"
          className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent"
        >
          Privacy policy
        </a>{" "}
        for how ad consent works.
      </p>
    ),
  },
  {
    title: "No warranty",
    body: (
      <p className="text-sm text-text-muted">
        DriverPit is provided "as is," built and maintained by a solo developer as a passion
        project. We don't guarantee it'll always be available, error-free, or that driver data is
        perfectly up to date, though we try to keep it accurate.
      </p>
    ),
  },
  {
    title: "Limitation of liability",
    body: (
      <p className="text-sm text-text-muted">
        To the fullest extent allowed by law, DriverPit and its developer aren't liable for any
        indirect, incidental, or consequential damages arising from your use of the service. It's a
        free game, not a service you're relying on for anything critical.
      </p>
    ),
  },
  {
    title: "Termination",
    body: (
      <p className="text-sm text-text-muted">
        We can suspend or remove an account that violates these terms. You can stop playing, or ask
        us to delete your account, at any time — see the Privacy policy for how.
      </p>
    ),
  },
  {
    title: "Changes to these terms",
    body: (
      <p className="text-sm text-text-muted">
        If these terms change meaningfully, we'll update this page and the date below.
      </p>
    ),
  },
  {
    title: "Contact",
    body: (
      <p className="text-sm text-text-muted">
        Questions about these terms? Reach us at{" "}
        <a
          href="mailto:privacy@driver-pit.vercel.app"
          className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent"
        >
          privacy@driver-pit.vercel.app
        </a>
        .
      </p>
    ),
  },
];

export function TermsOfService() {
  return (
    <section id="terms-of-service" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-text">Terms of service</h2>
        <p className="text-xs text-text-muted">Last updated {LAST_UPDATED}.</p>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.title} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-text">{section.title}</h3>
          {section.body}
        </div>
      ))}
    </section>
  );
}
