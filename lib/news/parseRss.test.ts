import { describe, expect, it } from "vitest";

import { parseRssItems, usableImageUrl } from "./parseRss";

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example F1 Feed</title>
    <item>
      <title><![CDATA[Hamilton & Verstappen clash at the "Belgian" GP]]></title>
      <link>https://example.com/news/1/?utm_source=RSS&amp;utm_medium=referral</link>
      <description><![CDATA[Some HTML <b>description</b> we don't care about.]]></description>
      <pubDate>Sat, 18 Jul 2026 21:21:23 +0000</pubDate>
      <enclosure url="https://example.com/img/1.jpg?w=800&amp;h=600" type="image/jpeg" length="12345"/>
    </item>
    <item>
      <title>Plain title without CDATA</title>
      <link>https://example.com/news/2/</link>
      <pubDate>Fri, 17 Jul 2026 09:00:00 +0000</pubDate>
      <enclosure type="image/png" url="https://example.com/img/2.png"/>
    </item>
    <item>
      <title>Missing pubDate is dropped</title>
      <link>https://example.com/news/3/</link>
    </item>
    <item>
      <title>Unparseable pubDate is dropped</title>
      <link>https://example.com/news/4/</link>
      <pubDate>not a date</pubDate>
    </item>
  </channel>
</rss>`;

describe("parseRssItems", () => {
  it("extracts title, link, and an ISO publishedAt from well-formed items", () => {
    const items = parseRssItems(SAMPLE_FEED);
    expect(items[1]).toEqual({
      title: "Plain title without CDATA",
      link: "https://example.com/news/2/",
      publishedAt: new Date("Fri, 17 Jul 2026 09:00:00 +0000").toISOString(),
      imageUrl: "https://example.com/img/2.png",
    });
  });

  it("extracts the enclosure image regardless of url/type attribute order", () => {
    const items = parseRssItems(SAMPLE_FEED);
    expect(items[0].imageUrl).toBe("https://example.com/img/1.jpg?w=800&h=600");
    expect(items[1].imageUrl).toBe("https://example.com/img/2.png");
  });

  it("leaves imageUrl null when an item has no enclosure", () => {
    const items = parseRssItems(SAMPLE_FEED);
    expect(items.find((item) => item.title === "Plain title without CDATA")).toBeTruthy();
    const noImageFeed = parseRssItems(`<rss><channel><item><title>No image</title><link>https://example.com/x</link><pubDate>Fri, 17 Jul 2026 09:00:00 +0000</pubDate></item></channel></rss>`);
    expect(noImageFeed[0].imageUrl).toBeNull();
  });

  it("unwraps CDATA and decodes entities in the title", () => {
    const items = parseRssItems(SAMPLE_FEED);
    expect(items[0].title).toBe('Hamilton & Verstappen clash at the "Belgian" GP');
  });

  it("decodes entities in the link", () => {
    const items = parseRssItems(SAMPLE_FEED);
    expect(items[0].link).toBe("https://example.com/news/1/?utm_source=RSS&utm_medium=referral");
  });

  it("drops items missing a pubDate", () => {
    const items = parseRssItems(SAMPLE_FEED);
    expect(items.some((item) => item.title === "Missing pubDate is dropped")).toBe(false);
  });

  it("drops items with an unparseable pubDate", () => {
    const items = parseRssItems(SAMPLE_FEED);
    expect(items.some((item) => item.title === "Unparseable pubDate is dropped")).toBe(false);
  });

  it("returns an empty array for a feed with no items", () => {
    expect(parseRssItems("<rss><channel></channel></rss>")).toEqual([]);
  });

  it("returns an empty array for garbage input", () => {
    expect(parseRssItems("not xml at all")).toEqual([]);
  });
});

describe("usableImageUrl", () => {
  it("keeps the absolute http(s) URLs the feeds actually ship", () => {
    for (const url of [
      "https://example.com/img/1.jpg?w=800&h=600",
      "http://cdn.example.com/a.png",
      "https://e0.365dm.com/26/08/1920x1080/x_7313566.jpg?20260805",
    ]) {
      expect(usableImageUrl(url)).toBe(url);
    }
  });

  it("rejects the empty and whitespace forms that became <img src=''>", () => {
    // The bug this closes: `""` is not `null`, so an `imageUrl !== null` check
    // downstream passed it through and the carousel rendered a full-height
    // slot around a broken image.
    expect(usableImageUrl("")).toBeNull();
    expect(usableImageUrl("   ")).toBeNull();
    expect(usableImageUrl(null)).toBeNull();
    expect(usableImageUrl(undefined)).toBeNull();
  });

  it("rejects anything that isn't absolute, since it would resolve against OUR origin", () => {
    expect(usableImageUrl("/img/x.jpg")).toBeNull();
    expect(usableImageUrl("//cdn.example.com/x.jpg")).toBeNull();
    expect(usableImageUrl("img/x.jpg")).toBeNull();
  });

  it("rejects non-http schemes and embedded whitespace", () => {
    expect(usableImageUrl("data:image/gif;base64,R0lGOD")).toBeNull();
    expect(usableImageUrl("javascript:alert(1)")).toBeNull();
    expect(usableImageUrl("https://example.com/a b.jpg")).toBeNull();
  });
});

describe("parseRssItems image validation", () => {
  function feedWithEnclosure(enclosure: string) {
    return `<rss><channel><item><title>T</title><link>https://example.com/x</link><pubDate>Fri, 17 Jul 2026 09:00:00 +0000</pubDate>${enclosure}</item></channel></rss>`;
  }

  it("treats an explicitly empty enclosure url as no image at all", () => {
    // Captured by `[^"]*` and then rejected -- with `[^"]+` this fell through
    // to the second attribute-order pattern and looked like a missing
    // enclosure, which is the same outcome by luck rather than by rule.
    expect(parseRssItems(feedWithEnclosure(`<enclosure url="" type="image/jpeg"/>`))[0].imageUrl).toBeNull();
    expect(parseRssItems(feedWithEnclosure(`<enclosure type="image/jpeg" url=""/>`))[0].imageUrl).toBeNull();
  });

  it("still keeps the item itself -- only its image is dropped", () => {
    // getLatestNews decides what to do about an imageless item; the parser's
    // job is only to be honest that there isn't one.
    const items = parseRssItems(feedWithEnclosure(`<enclosure url="   " type="image/jpeg"/>`));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("T");
  });
});
