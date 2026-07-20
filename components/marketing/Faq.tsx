const QA: { q: string; a: string }[] = [
  {
    q: "How often does the daily puzzle change?",
    a: "A new mystery driver is chosen once a day, at 00:00 UTC, the same one for everyone. The countdown shown after you finish converts that reset to your local time.",
  },
  {
    q: "Why can't I guess a driver who isn't in the list?",
    a: "Every guess has to be a real driver, so the comparison always has something meaningful to show. Start typing a name and pick from the matches — misspellings aren't accepted as a guess. The autocomplete only suggests names from the active driver pool, but if you know a driver outside it, typing their full name and selecting them still works.",
  },
  {
    q: "What counts as a driver's \"team\"?",
    a: "Mainly the constructor they most recently raced for — that's what has to match exactly for a green tile. But if you guess a team the mystery driver has raced for at any point in their career, the tile turns a dim orange instead of grey, so you still get a hint even when your guess is out of date.",
  },
  {
    q: "What does the shading on Age, Debut, and Wins mean?",
    a: "Beyond the up/down arrow, those three tiles shade from grey toward bright orange based on how close your guess was — a wild guess stays dim, a near-miss glows. It's a hint about magnitude, not just direction.",
  },
  {
    q: "Is \"Age\" the driver's age when they debuted, or now?",
    a: "Their current age — or their age at death, for drivers who have since passed away — not their age when they started racing.",
  },
  {
    q: "What's the small code shown next to each guess?",
    a: "That's the driver's official F1DB abbreviation — the same three-letter codes used on TV timing screens, like VER or HAM. It's not guaranteed unique across every driver in history, but it's always shown attached to one specific row, so there's no ambiguity about who it refers to.",
  },
  {
    q: "Which drivers are in the pool, and can I change it?",
    a: "The database holds every driver who's ever started a Grand Prix, but Daily and Duel always draw from Regular — anyone who's raced in the last 10 seasons. Infinite mode lets you pick the pool yourself: Amateur (this season only), Regular (10 years), Professional (20 years), Veteran (30 years), or Legend (the sport's entire history). Your choice is remembered for next time.",
  },
  {
    q: "Is there a way to play against someone else?",
    a: "Duel mode puts two players against the same mystery driver, drawn from the Regular pool, in a shared room. You'll see the colors and arrows from your opponent's guesses, but never who they actually guessed.",
  },
  {
    q: "Do you store any personal information?",
    a: "Every visitor gets an anonymous guest identity automatically, just so stats and duel matchmaking work — no personal information involved. If you create a full account (email or Google), we store your email, username, avatar, and gameplay stats so they follow you across devices. See the Privacy policy for the full details, and what to do if you'd rather not.",
  },
  {
    q: "Do I need an account to play?",
    a: "No — every visitor can play Daily, Infinite, and Duel straight away as a guest, no sign-up required. Creating a full account (email or Google) is only needed to appear on the global leaderboard and set a custom username, display name, or avatar.",
  },
  {
    q: "How does Duel matchmaking and rating work?",
    a: "Joining the queue matches you against another waiting player, roughly by duel rating when possible — the pairing widens how far apart your ratings can be the longer you wait. A match is 3 rounds, one driver each, unlimited guesses against a countdown timer; solving faster scores more, and even a DNF earns a few points for how close your best guess was. Your rating updates once the match ends.",
  },
  {
    q: "Why do I see ads?",
    a: "DriverPit is free to play and ad-supported through Google AdSense — ads only ever show outside of an active Duel match, never mid-race. If you're in the EEA, UK, or Switzerland, you'll get a consent choice before any ad personalization is switched on.",
  },
  {
    q: "Can I change my avatar or display name?",
    a: "Yes, under Settings → Profile — full accounts can pick a new avatar from the picker (with a shuffle for more options) and edit their display name any time. Guests get a random avatar and a generated handle until they sign up.",
  },
  {
    q: "What is Knockout mode?",
    a: "A planned 20-player elimination mode, not live yet — you'll see it listed (marked \"coming soon\") when you open Duel's matchmaking screen. It'll reuse the same live-match engine as Duel, with everyone guessing the same driver as new hints reveal automatically and the slowest players eliminated each round.",
  },
];

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function Faq() {
  return (
    <section id="faq" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">FAQ</h2>
      <div className="flex flex-col gap-2">
        {QA.map((item) => (
          <details key={item.q} className="group rounded-lg border border-border bg-surface-2 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronIcon />
            </summary>
            <p className="mt-2 text-sm text-text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
