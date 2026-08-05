import { parseRssItems } from "./parseRss";

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string; // ISO 8601
  imageUrl: string | null;
}

// What getLatestNews actually hands back. The carousel is one big image with a
// caption under it, so an item with no image isn't a smaller version of a story
// -- it's an empty grey box with text below, which reads as a failed load
// rather than a design. Making the guarantee a TYPE rather than a convention is
// what lets the carousel drop its placeholder branch without that becoming a
// crash waiting for the first imageless feed item.
export type NewsItemWithImage = NewsItem & { imageUrl: string };

interface FeedConfig {
  url: string;
  source: string;
}

// formula1.com's official feed was evaluated too, but its <item>s carry no
// pubDate/dc:date at all -- parseRssItems (rightly) drops undated items, so
// it would never contribute anything. planetf1.com's feed URL currently
// 404s/redirects to a WordPress error page -- also skipped.
//
// RaceFans was dropped for the same reason as formula1.com, once the carousel
// began requiring an image: measured 2026-08-05, all 20 of its items carry no
// <enclosure>, no <media:content> and no <media:thumbnail> (independent
// blog-style site -- its images live in the HTML body), so every one of them is
// now filtered out below. Keeping it listed would spend a request and an hourly
// crawl of someone else's server on items that can never be shown. It earns its
// place back the day parseRssItems learns to pull the first <img> out of
// <content:encoded>.
//
// All four below returned 50/50, 50/50, 50/50 and 20/20 items with image
// enclosures on that same check.
const FEEDS: FeedConfig[] = [
  { url: "https://www.motorsport.com/rss/f1/news/", source: "Motorsport.com" },
  { url: "https://www.autosport.com/rss/f1/news/", source: "Autosport" },
  { url: "https://www.crash.net/rss/f1", source: "Crash.net" },
  { url: "https://www.skysports.com/rss/12433", source: "Sky Sports" },
];

const REVALIDATE_SECONDS = 60 * 60;
const REQUEST_TIMEOUT_MS = 5000;

async function fetchFeed(feed: FeedConfig): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(feed.url, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: controller.signal,
      // The contact URL must be OURS: a feed operator who wants to rate-limit or
      // block this crawler follows it. It used to point at github.com/f1db/f1db
      // (copy-pasted from the seed's source), which sent five news publishers to
      // the F1DB maintainers about traffic they didn't generate.
      headers: { "User-Agent": "DriverPitBot/1.0 (+https://driver-pit.vercel.app)" },
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

function hasImage(item: NewsItem): item is NewsItemWithImage {
  return item.imageUrl !== null;
}

// Server-only: called from the News server component, never from the
// client. Each feed fails independently so one dead source doesn't blank
// out the others.
//
// The image filter runs BEFORE the slice, not after: filtering the top five
// would quietly return three stories on a day when two of them happened to be
// imageless, which looks like the feeds being half-down. `limit` means "five
// stories the carousel can actually show".
export async function getLatestNews(limit = 5): Promise<NewsItemWithImage[]> {
  const results = await Promise.all(FEEDS.map(fetchFeed));

  return results
    .flat()
    .filter(hasImage)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);
}
