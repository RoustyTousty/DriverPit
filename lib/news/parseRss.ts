export interface FeedItem {
  title: string;
  link: string;
  publishedAt: string; // ISO 8601
  imageUrl: string | null;
}

// Handles the numeric/hex entities RSS titles commonly carry (curly quotes,
// em dashes) plus the standard named ones. &amp; must decode last, or a
// sequence like "&amp;lt;" would wrongly collapse to "<" instead of "&lt;".
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return null;

  const raw = match[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return decodeEntities((cdata ? cdata[1] : raw).trim());
}

// "There is an <enclosure>" and "there is an image to show" are not the same
// claim, and the gap between them is what put empty grey boxes in the carousel:
// a feed can ship url="" or url=" ", and `""` is not `null`, so an emptiness
// check spelled `imageUrl !== null` downstream waves it straight through into
// `<img src="">` -- which every browser renders as a broken/blank image inside
// a full-height slot. A relative or protocol-less URL fails the same way, since
// this is resolved against OUR origin, not the feed's.
//
// So the check happens once, HERE, at the only place a URL enters the app:
// anything that isn't an absolute http(s) URL becomes `null`, which is the
// value the rest of the pipeline already knows how to drop.
export function usableImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Whitespace inside a URL means the attribute captured something that isn't
  // one; `new URL` would happily strip it and hand back a plausible-looking
  // address for a resource nobody published.
  if (/\s/.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Relative ("/img/x.jpg") or protocol-relative ("//cdn/x.jpg") -- both are
    // meaningless without the feed's own base, which we don't track.
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return trimmed;
}

// <enclosure> is a self-closing tag with url/type as attributes, not text
// content, and feeds don't agree on attribute order -- match both. `[^"]*`
// rather than `[^"]+` on the url so an explicitly empty url="" is CAPTURED and
// then rejected above, instead of falling through to the second pattern and
// looking like a feed that simply had no enclosure.
function extractEnclosureImage(block: string): string | null {
  const match =
    block.match(/<enclosure\b[^>]*\burl="([^"]*)"[^>]*\btype="image\/[^"]*"/i) ??
    block.match(/<enclosure\b[^>]*\btype="image\/[^"]*"[^>]*\burl="([^"]*)"/i);
  return match ? usableImageUrl(decodeEntities(match[1])) : null;
}

// Deliberately not a general-purpose XML parser: RSS <item> blocks are
// predictable enough that a couple of regexes cover title/link/pubDate
// without pulling in a dependency for three fields.
export function parseRssItems(xml: string): FeedItem[] {
  const itemBlocks = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ?? [];

  const items: FeedItem[] = [];
  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    if (!title || !link || !pubDate) continue;

    const publishedAt = new Date(pubDate);
    if (Number.isNaN(publishedAt.getTime())) continue;

    items.push({ title, link, publishedAt: publishedAt.toISOString(), imageUrl: extractEnclosureImage(block) });
  }
  return items;
}
