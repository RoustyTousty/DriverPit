import { MoreLink } from "./MoreLink";

const QA: { q: string; a: string }[] = [
  {
    q: "How often does the daily puzzle change?",
    a: "A new mystery driver is chosen once a day, at 00:00 UTC, the same one for everyone.",
  },
  {
    q: "Why can't I guess a driver who isn't in the list?",
    a: "Every guess has to be a real driver. Start typing a name and pick from the matches — misspellings aren't accepted as a guess.",
  },
  {
    q: "What counts as a driver's \"team\"?",
    a: "Their most recent constructor for a green tile — but a team they've raced for at any point turns a dim orange instead of grey.",
  },
  {
    q: "What does the shading on Age, Debut, and Wins mean?",
    a: "Those tiles shade from grey toward bright orange based on how close your guess was — a hint about magnitude, not just direction.",
  },
  {
    q: "Which drivers are in the pool, and can I change it?",
    a: "Daily and Duel always draw from Regular (last 10 seasons). Infinite lets you pick the pool yourself, from this season only up to the sport's entire history.",
  },
  {
    q: "Is there a way to play against someone else?",
    a: "Duel mode races you and a matchmade opponent against the same mystery driver — you'll see their guess colors, but never who they guessed.",
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

export function FaqTeaser() {
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
      <MoreLink href="/faq">See all FAQ</MoreLink>
    </section>
  );
}
