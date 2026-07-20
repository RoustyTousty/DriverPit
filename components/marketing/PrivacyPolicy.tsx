const LAST_UPDATED = "July 2026";

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Overview",
    body: (
      <p className="text-sm text-text-muted">
        DriverPit is a small, independently-run F1 guessing game. This page explains what data we
        collect when you play, why we collect it, and what choices you have about it. We collect
        as little as we can get away with — enough to run accounts, stats, and the duel
        leaderboard, and nothing beyond that.
      </p>
    ),
  },
  {
    title: "Accounts and gameplay data",
    body: (
      <div className="flex flex-col gap-2 text-sm text-text-muted">
        <p>
          Every visitor gets a real account from the moment they arrive, even if they never sign
          up — a random, anonymous <span className="font-medium text-text">guest</span> identity
          (shown as a handle like <code className="text-xs">user482913</code>) is created so guests
          can play Daily, Infinite, and Duel and have their stats tracked without handing over any
          personal information.
        </p>
        <p>
          If you choose to create a full account with an email address, or sign in with Google, we
          store: your email address (or the email Google shares with us), a username and optional
          display name, an avatar, and your gameplay stats — games played, win rate, streaks, guess
          distribution, and your duel rating, wins, and losses. Signing up links to your existing
          guest identity rather than replacing it, so nothing you'd already played is lost.
        </p>
        <p>
          We don't ask for your real name, date of birth, or any payment information — there's
          nothing to buy here.
        </p>
      </div>
    ),
  },
  {
    title: "Cookies and local storage",
    body: (
      <div className="flex flex-col gap-2 text-sm text-text-muted">
        <p>
          A session cookie keeps you signed in between visits. Some game settings (hard mode,
          reduced motion, your preferred driver pool) are stored in your browser's local storage
          and never leave your device.
        </p>
        <p>
          Once ads are enabled, we also use cookies for advertising — see{" "}
          <span className="font-medium text-text">Advertising</span> below for how that's gated
          behind your consent.
        </p>
      </div>
    ),
  },
  {
    title: "Advertising",
    body: (
      <div className="flex flex-col gap-2 text-sm text-text-muted">
        <p>
          DriverPit is supported by Google AdSense. If you're visiting from the EEA, UK, or
          Switzerland, ad cookies and personalization stay switched off by default (Google Consent
          Mode v2) until you actively respond to the consent banner — you can accept, decline, or
          open "Manage options" to choose more precisely, and you can change your mind later by
          re-opening that banner.
        </p>
        <p>
          Ads are hidden entirely during a live Duel match — a race is the wrong moment for a
          banner.
        </p>
      </div>
    ),
  },
  {
    title: "Who we share data with",
    body: (
      <div className="flex flex-col gap-2 text-sm text-text-muted">
        <p>We don't sell your data. It's shared only with the services that run the site itself:</p>
        <ul className="flex flex-col gap-1.5">
          {[
            "Supabase — hosts the database, authentication, and real-time matchmaking/duel connections.",
            "Vercel — hosts and serves the site.",
            "Google AdSense / Google's consent messaging (Funding Choices) — serves ads and records your consent choice, once ads are enabled.",
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
        <p>
          Driver stats themselves — nationality, team, age, debut year, career wins — come from the
          public{" "}
          <a
            href="https://github.com/f1db/f1db"
            className="font-medium text-text underline decoration-border underline-offset-2 hover:text-accent"
          >
            F1DB
          </a>{" "}
          database and the Jolpica-F1 API, and the news carousel pulls public RSS feeds from
          motorsport press outlets. None of that involves sending any of your data anywhere —
          it's just how the game content gets built.
        </p>
      </div>
    ),
  },
  {
    title: "How long we keep it",
    body: (
      <p className="text-sm text-text-muted">
        Account data and stats are kept for as long as your account exists. Guest identities that
        never convert to a full account are effectively abandoned rather than actively deleted, but
        carry no personal information to begin with. If you'd like your account and its data
        removed entirely, contact us (below) and we'll delete it.
      </p>
    ),
  },
  {
    title: "Your choices",
    body: (
      <ul className="flex flex-col gap-1.5 text-sm text-text-muted">
        {[
          "Guests: your stats live only in your session until you sign up — clearing your browser data or using Settings → Reset local stats wipes it for good.",
          "Full accounts: Settings → Profile shows exactly what's stored and lets you edit your avatar and display name yourself.",
          "Ad consent can be changed at any time by re-opening the consent banner.",
          "Ask us to access, correct, or delete your data at any point — see Contact below.",
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
    title: "Children's privacy",
    body: (
      <p className="text-sm text-text-muted">
        DriverPit isn't directed at children, and we don't knowingly collect data from anyone under
        13. If you believe a child has created an account, contact us and we'll remove it.
      </p>
    ),
  },
  {
    title: "Changes to this policy",
    body: (
      <p className="text-sm text-text-muted">
        If how we handle data changes meaningfully, we'll update this page and the date below.
      </p>
    ),
  },
  {
    title: "Contact",
    body: (
      <p className="text-sm text-text-muted">
        Questions, or want your data accessed or deleted? Reach us at{" "}
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

export function PrivacyPolicy() {
  return (
    <section id="privacy-policy" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-text">Privacy policy</h2>
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
