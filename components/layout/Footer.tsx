import Link from "next/link";

// Fill in real profile URLs when ready -- icon-only for now, so the row is
// in place before any account exists to link to.
const SOCIAL_LINKS: { label: string; href: string; icon: React.ReactNode }[] = [
  {
    label: "TikTok",
    href: "#",
    icon: (
      <path d="M16.5 3c.3 2.1 1.7 3.8 3.8 4.2v2.6c-1.4 0-2.7-.4-3.8-1.2v6.7a5.7 5.7 0 1 1-5.7-5.7c.3 0 .6 0 .9.1v2.7a3 3 0 1 0 2.1 2.9V3h2.7Z" />
    ),
  },
  {
    label: "Instagram",
    href: "#",
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth={1.75} />
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth={1.75} />
        <circle cx="17.2" cy="6.8" r="1.1" />
      </>
    ),
  },
  {
    label: "X",
    href: "#",
    icon: (
      <path d="M17.8 3h2.6l-5.7 6.5L21.4 21h-5.3l-4.1-5.4-4.7 5.4H4.6l6.1-7-6.6-8.9h5.4l3.7 5 4.6-5Zm-.9 16.2h1.4L7.2 4.7H5.7l11.2 14.5Z" />
    ),
  },
  {
    label: "Discord",
    href: "#",
    icon: (
      <path d="M18.9 6.4A16 16 0 0 0 15 5.2l-.4.8a13 13 0 0 1 3.4 1.4 13.6 13.6 0 0 0-12 0 13 13 0 0 1 3.4-1.4l-.4-.8a16 16 0 0 0-3.9 1.2C2.9 9.7 2.2 12.9 2.5 16c1.3 1 2.7 1.7 4.2 2.1l.6-1.1a9 9 0 0 1-1.9-1c2.9 1.3 6.1 1.3 9 0a9 9 0 0 1-1.9 1l.6 1.1c1.5-.4 2.9-1.1 4.2-2.1.4-3.6-.5-6.7-2.4-9.6ZM9 14.2c-.8 0-1.5-.8-1.5-1.7 0-1 .7-1.7 1.5-1.7s1.5.8 1.5 1.7c0 1-.7 1.7-1.5 1.7Zm6 0c-.8 0-1.5-.8-1.5-1.7 0-1 .7-1.7 1.5-1.7s1.5.8 1.5 1.7c0 1-.7 1.7-1.5 1.7Z" />
    ),
  },
];

const INFO_LINKS = [
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/game-modes", label: "Game modes" },
  { href: "/how-to-play", label: "How to play" },
  { href: "/daily", label: "Play now" },
];

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-240 flex-col items-center gap-4 px-4 py-6">
        <div className="flex items-center gap-2">
          {SOCIAL_LINKS.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={social.label}
              className="rounded-lg p-2 text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5" aria-hidden="true">
                {social.icon}
              </svg>
            </a>
          ))}
        </div>

        <nav aria-label="Info pages" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          {INFO_LINKS.map((link, index) => (
            <span key={link.href} className="flex items-center gap-2">
              {index > 0 && (
                <span className="text-text-muted" aria-hidden="true">
                  ·
                </span>
              )}
              <Link href={link.href} className="text-xs text-text-muted transition hover:text-text">
                {link.label}
              </Link>
            </span>
          ))}
        </nav>

        <p className="text-center text-xs text-text-muted">
          © {new Date().getFullYear()} DriverPit. Not affiliated with Formula 1, the FIA, or any team.
        </p>
      </div>
    </footer>
  );
}
