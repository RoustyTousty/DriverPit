import { describe, expect, it } from "vitest";

import {
  ARCHIVE_PAGE_SIZE,
  PAGE_GAP,
  archivePageCount,
  archivePagePath,
  archivePageWindow,
  parseArchivePage,
} from "./archivePaging";

// The pagination rules, which are pure and whose failures are all silent: a
// second URL for page 1 is duplicate content, an off-by-one page count is a
// soft 404 in the sitemap, and a permissive parser lets a crawler wander into
// /archive/page/99999.

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

describe("archivePageWindow", () => {
  it("lists every page while they all fit", () => {
    expect(archivePageWindow(1, 1)).toEqual([1]);
    expect(archivePageWindow(2, 3)).toEqual([1, 2, 3]);
    expect(archivePageWindow(1, 4)).toEqual([1, 2, 3, 4]);
  });

  it("starts eliding as soon as more than one page is hidden", () => {
    expect(archivePageWindow(1, 5)).toEqual([1, 2, PAGE_GAP, 5]);
  });

  it("keeps the first and last page reachable from anywhere", () => {
    // The whole reason the window exists: with ten days to a page, prev/next
    // alone puts page 37 thirty-six clicks from page 1.
    for (const page of [1, 5, 19, 37]) {
      const slots = archivePageWindow(page, 37);
      expect(slots[0]).toBe(1);
      expect(slots[slots.length - 1]).toBe(37);
      expect(slots).toContain(page);
    }
  });

  it("collapses a long run into a single gap", () => {
    expect(archivePageWindow(19, 37)).toEqual([1, PAGE_GAP, 18, 19, 20, PAGE_GAP, 37]);
  });

  // An ellipsis standing in for one hidden page spends the same width as the
  // number to say less, and reads as a rendering fault.
  it("prints a lone skipped page rather than eliding it", () => {
    expect(archivePageWindow(4, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(archivePageWindow(1, 4)).toEqual([1, 2, 3, 4]);
  });

  it("never emits a duplicate or an out-of-range page", () => {
    for (let total = 1; total <= 12; total += 1) {
      for (let page = 1; page <= total; page += 1) {
        const numbers = archivePageWindow(page, total).filter(
          (slot): slot is number => slot !== PAGE_GAP,
        );
        expect(new Set(numbers).size).toBe(numbers.length);
        expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
        for (const n of numbers) {
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(total);
        }
      }
    }
  });

  it("clamps a page outside the range instead of inventing slots for it", () => {
    expect(archivePageWindow(0, 5)).toEqual(archivePageWindow(1, 5));
    expect(archivePageWindow(99, 5)).toEqual(archivePageWindow(5, 5));
  });
});
