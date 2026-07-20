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
    // Official mark (via Simple Icons) -- the previous hand-approximated
    // path had coordinates that fell outside the 0-24 viewBox, which SVG
    // clips by default, so part of the glyph was silently cut off.
    label: "X",
    href: "#",
    icon: (
      <path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" />
    ),
  },
  {
    // Official mark (via Simple Icons) -- same clipping issue as X above.
    label: "Discord",
    href: "#",
    icon: (
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    ),
  },
];

const INFO_LINKS = [
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/game-modes", label: "Game modes" },
  { href: "/how-to-play", label: "How to play" },
  { href: "/privacy-policy", label: "Privacy" },
  { href: "/terms-of-service", label: "Terms" },
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
