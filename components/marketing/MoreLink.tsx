import Link from "next/link";

// The one deliberate use of accent orange in the marketing sections beyond
// the wordmark -- a single small, consistent affordance pointing at each
// section's full detail page, not a section fill or a heading.
export function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="self-start text-sm font-semibold text-accent transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children} <span aria-hidden="true">→</span>
    </Link>
  );
}
