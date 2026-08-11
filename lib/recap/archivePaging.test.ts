import { describe, expect, it } from "vitest";

import {
  ARCHIVE_PAGE_SIZE,
  archivePageCount,
  archivePagePath,
  parseArchivePage,
} from "@/components/archive/ArchiveIndex";

// The pagination rules, which are pure and whose failures are all silent: a
// second URL for page 1 is duplicate content, an off-by-one page count is a
// soft 404 in the sitemap, and a permissive parser lets a crawler wander into
// /archive/page/99999.
//
// Lives under lib/ because that is where the `node` vitest project looks; what
// is under test is arithmetic, not a rendered component.

describe("archivePagePath", () => {
  it("gives page 1 the bare /archive URL and nothing else", () => {
    expect(archivePagePath(1)).toBe("/archive");
    expect(archivePagePath(0)).toBe("/archive");
    expect(archivePagePath(2)).toBe("/archive/page/2");
    expect(archivePagePath(17)).toBe("/archive/page/17");
  });
});

describe("parseArchivePage", () => {
  // The load-bearing one: /archive/page/1 would serve the same rows as
  // /archive, and two URLs for one list is the own-goal canonicals exist to
  // prevent. It 404s rather than redirecting, because nothing links to it.
  it("rejects 1, so page one has exactly one URL", () => {
    expect(parseArchivePage("1")).toBeNull();
  });

  it("accepts a plain page number", () => {
    expect(parseArchivePage("2")).toBe(2);
    expect(parseArchivePage("40")).toBe(40);
  });

  it("rejects anything that is not one", () => {
    for (const bad of ["", "0", "-3", "2.5", "02", "2a", " 2", "1e3", "abc", "٢"]) {
      expect(parseArchivePage(bad)).toBeNull();
    }
  });

  it("rejects a number past the safe integer range rather than overflowing", () => {
    expect(parseArchivePage("999999999999999999999")).toBeNull();
  });
});

describe("archivePageCount", () => {
  it("always has a page one, even with nothing to show", () => {
    expect(archivePageCount(0)).toBe(1);
  });

  it("does not add a page for an exact fill", () => {
    expect(archivePageCount(ARCHIVE_PAGE_SIZE)).toBe(1);
    expect(archivePageCount(ARCHIVE_PAGE_SIZE * 2)).toBe(2);
  });

  it("adds one for the remainder", () => {
    expect(archivePageCount(ARCHIVE_PAGE_SIZE + 1)).toBe(2);
    expect(archivePageCount(ARCHIVE_PAGE_SIZE * 2 + 1)).toBe(3);
  });
});
