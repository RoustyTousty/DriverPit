import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ArchivePagination } from "./ArchivePagination";

// Ten days to a page makes a year of archive 37 pages, so prev/next alone puts
// the oldest day 36 clicks from the newest -- for a reader, and for a crawler
// walking the only path it has inward. The window arithmetic is pinned in
// lib/recap/archivePaging.test.ts; what is pinned here is that it reaches the
// DOM as links, that the current page is marked once, and that the current page
// is NOT a link to itself.

function pageLinks(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("/archive"));
}

describe("ArchivePagination", () => {
  it("renders nothing when the whole archive fits on one page", () => {
    const { container } = render(<ArchivePagination page={1} pageCount={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps page 1 and the last page one click away from the middle", () => {
    render(<ArchivePagination page={19} pageCount={37} />);

    const hrefs = pageLinks();
    expect(hrefs).toContain("/archive");
    expect(hrefs).toContain("/archive/page/37");
  });

  it("marks exactly one page as current, and does not link it to itself", () => {
    render(<ArchivePagination page={19} pageCount={37} />);

    const current = screen.getAllByText("19").filter((el) => el.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(pageLinks()).not.toContain("/archive/page/19");
  });

  // Page 1 is `/archive`; `/archive/page/1` would be a second URL serving the
  // same rows, which is the duplicate-content own-goal the canonical exists to
  // prevent -- and `parseArchivePage` 404s it, so a link here would be broken.
  it("links page one at /archive and never at /archive/page/1", () => {
    render(<ArchivePagination page={3} pageCount={9} />);

    expect(pageLinks()).toContain("/archive");
    expect(pageLinks()).not.toContain("/archive/page/1");
  });

  it("drops the prev arrow's link on the first page and the next arrow's on the last", () => {
    const { rerender } = render(<ArchivePagination page={1} pageCount={9} />);
    expect(screen.queryByRole("link", { name: /newer/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /older/i })).toBeInTheDocument();

    rerender(<ArchivePagination page={9} pageCount={9} />);
    expect(screen.getByRole("link", { name: /newer/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /older/i })).not.toBeInTheDocument();
  });
});
