import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModeTabs } from "./ModeTabs";

// Roadmap Pass 5 moved the daily game from /daily to /, which makes the Daily
// tab's href `/` -- and `/` is a prefix of every route on the site. The active
// state is decided from the pathname, so the obvious prefix comparison lights
// Daily up on /infinite and /online as well, leaving two `aria-selected="true"`
// in one tablist: a screen reader announces two selected tabs and both get the
// accent fill. Nothing errors, and it is the exact trap the roadmap warns about.
//
// So what is pinned here is a property rather than a case: EXACTLY ONE tab is
// active, on every route the shell serves. Written to fail against a naive
// `pathname.startsWith(tab.href)` -- it reports two on /infinite and /online.

const mockPathname = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

// Hovering Infinite speculatively starts a round; that path reaches supabase and
// has nothing to do with which tab is lit.
vi.mock("@/lib/game/infiniteRoundPrefetch", () => ({ prefetchInfiniteRound: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function activeTabNames(): string[] {
  return screen
    .getAllByRole("tab")
    .filter((tab) => tab.getAttribute("aria-selected") === "true")
    .map((tab) => tab.textContent ?? "");
}

describe("ModeTabs", () => {
  it.each([
    ["/", "Daily"],
    ["/infinite", "Infinite"],
    ["/online", "Online"],
  ])("lights exactly one tab on %s", (pathname, expected) => {
    mockPathname.mockReturnValue(pathname);
    render(<ModeTabs />);

    expect(activeTabNames()).toEqual([expected]);
  });

  it("links Daily at / rather than at the /daily redirect", () => {
    mockPathname.mockReturnValue("/");
    render(<ModeTabs />);

    // A tab pointing at /daily would make every switch back to Daily pay a 308,
    // which is the whole cost this pass removed.
    expect(screen.getByRole("tab", { name: "Daily" })).toHaveAttribute("href", "/");
  });

  it("still matches a nested route under a non-root tab", () => {
    // The prefix arm is kept for routes below a tab (a future /online/...), so
    // narrowing everything to equality to fix the root case would be the wrong
    // fix. Nothing nests today; this is what stops that arm being dropped.
    mockPathname.mockReturnValue("/online/something");
    render(<ModeTabs />);

    expect(activeTabNames()).toEqual(["Online"]);
  });
});
