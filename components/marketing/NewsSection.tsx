import { Suspense } from "react";

import { getLatestNews } from "@/lib/news/fetchNews";
import { formatRelativeTime } from "@/lib/news/relativeTime";

async function NewsList() {
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

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.link}>
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-border bg-surface-2 p-4 transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <p className="text-sm font-medium text-text">{item.title}</p>
            <p className="mt-1 text-xs text-text-muted">
              {item.source} · {formatRelativeTime(item.publishedAt)}
            </p>
          </a>
        </li>
      ))}
    </ul>
  );
}

function NewsListSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <li key={index} className="rounded-lg border border-border bg-surface-2 p-4">
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-border motion-reduce:animate-none" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-border motion-reduce:animate-none" />
        </li>
      ))}
    </ul>
  );
}

export function NewsSection() {
  return (
    <section id="news" className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-text">Latest F1 news</h2>
      <p className="text-sm text-text-muted">Recent headlines from the F1 press, refreshed hourly.</p>
      <Suspense fallback={<NewsListSkeleton />}>
        <NewsList />
      </Suspense>
    </section>
  );
}
