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

// <enclosure> is a self-closing tag with url/type as attributes, not text
// content, and feeds don't agree on attribute order -- match both.
function extractEnclosureImage(block: string): string | null {
  const match =
    block.match(/<enclosure\b[^>]*\burl="([^"]+)"[^>]*\btype="image\/[^"]*"/i) ??
    block.match(/<enclosure\b[^>]*\btype="image\/[^"]*"[^>]*\burl="([^"]+)"/i);
  return match ? decodeEntities(match[1]) : null;
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
