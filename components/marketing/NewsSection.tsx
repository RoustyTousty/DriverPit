import { Suspense } from "react";

import { getLatestNews } from "@/lib/news/fetchNews";

import { NewsCarousel } from "./NewsCarousel";

async function NewsBody() {
  const items = await getLatestNews();

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-2 p-6 text-center">
        <p className="text-sm text-text-muted">
          Couldn&apos;t reach the news feed right now — check back soon.
        </p>
      </div>
    );
  }

  return <NewsCarousel items={items} />;
}

// Mirrors the real card's shape, not just its image: 16:9 photo plus the
// two-line caption block under it. Without the caption the skeleton is ~76px
// shorter than what replaces it, so the whole page below jumps at the moment
// the feed lands -- which is the one thing a skeleton exists to prevent.
function NewsSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" aria-hidden="true">
      <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
        <div className="aspect-video w-full bg-surface" />
        <div className="flex flex-col gap-2 p-4">
          <div className="h-4 w-3/4 rounded bg-surface" />
          <div className="h-3 w-2/5 rounded bg-surface" />
        </div>
      </div>
      <div className="mt-3 flex justify-center gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-1.5 w-1.5 rounded-full bg-border" />
        ))}
      </div>
    </div>
  );
}

export function NewsSection() {
  return (
    <section id="news" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">Latest F1 news</h2>
      <p className="text-sm text-text-muted">Recent headlines from the F1 press, refreshed hourly.</p>
      <Suspense fallback={<NewsSkeleton />}>
        <NewsBody />
      </Suspense>
    </section>
  );
}
