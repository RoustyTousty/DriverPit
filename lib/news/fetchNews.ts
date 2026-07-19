import { parseRssItems } from "./parseRss";

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string; // ISO 8601
}

interface FeedConfig {
  url: string;
  source: string;
}

const FEEDS: FeedConfig[] = [{ url: "https://www.motorsport.com/rss/f1/news/", source: "Motorsport.com" }];

const REVALIDATE_SECONDS = 60 * 60;
const REQUEST_TIMEOUT_MS = 5000;

async function fetchFeed(feed: FeedConfig): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(feed.url, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: controller.signal,
      headers: { "User-Agent": "DriverPitBot/1.0 (+https://github.com/f1db/f1db)" },
    });
    if (!response.ok) return [];

    const xml = await response.text();
    return parseRssItems(xml).map((item) => ({ ...item, source: feed.source }));
  } catch {
    // Feed down, timed out, or malformed — degrade to no items from this
    // source rather than failing the whole news section.
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// Server-only: called from the News server component, never from the
// client. Each feed fails independently so one dead source doesn't blank
// out the others.
export async function getLatestNews(limit = 6): Promise<NewsItem[]> {
  const results = await Promise.all(FEEDS.map(fetchFeed));

  return results
    .flat()
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);
}
