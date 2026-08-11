import { Footer } from "@/components/layout/Footer";
import { InfoTopBar } from "@/components/layout/InfoTopBar";

// Standalone info pages (about/faq/game-modes/how-to-play) -- same site
// shell (topbar + footer) as app/(game)/layout.tsx, but no mode tabs, ad
// slot, or marketing teasers; these pages *are* the full-detail content the
// home page's compact sections link out to.
export default function InfoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <InfoTopBar />
      <main className="mx-auto w-full max-w-180 flex-1 px-4 py-12">{children}</main>
      <Footer />
    </>
  );
}
