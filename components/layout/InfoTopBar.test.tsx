import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InfoTopBar } from "./InfoTopBar";

// Audit 2026-07-30 §4.5. The collapsed (<sm) info nav was copied from
// PoolSelect's markup, roles included, and kept role="combobox" /
// role="listbox" / role="option" with none of the keyboard model those roles
// promise. The resolution was to DROP the roles rather than implement the
// handlers -- PoolSelect picks a value and must be a combobox; this picks a
// page and is four links -- so what these tests pin is the absence of an ARIA
// claim, which is exactly the kind of thing a later "make these two match"
// pass would silently put back.
//
// Written to fail against the pre-fix component: three of the four below did
// (combobox, listbox+option, focus-on-Escape).

const mockPathname = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

// The real one needs a StaticImageData object; vite hands the .png import back
// as a bare URL string, which next/image rejects for missing width/height.
// Nothing here is about the logo, so the stand-in is a span carrying the same
// alt text (an <img> would trip @next/next/no-img-element for no gain) --
// which leaves the logo link's accessible name what it is in the real header.
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

beforeEach(() => {
  mockPathname.mockReturnValue("/faq");
});

// Both the wide-viewport <nav> row and the collapsed dropdown are in the DOM at
// once -- which one shows is a Tailwind `sm:` breakpoint, and jsdom applies no
// CSS -- so every query about the dropdown is scoped to it rather than to the
// document.
function openMenu() {
  return userEvent.setup().click(screen.getByRole("button", { name: "Info pages" }));
}

describe("InfoTopBar's collapsed nav", () => {
  it("is a disclosure button, not a combobox", () => {
    render(<InfoTopBar />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Info pages" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // aria-controls names the panel it opens -- the one promise a disclosure
    // makes, and one the browser keeps without a keydown handler.
    expect(trigger).toHaveAttribute("aria-controls", "info-nav-menu");
    expect(trigger).not.toHaveAttribute("aria-haspopup");
  });

  it("opens a list of links, not a listbox of options", async () => {
    render(<InfoTopBar />);
    await openMenu();

    expect(screen.getByRole("button", { name: "Info pages" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    const menu = document.getElementById("info-nav-menu");
    expect(menu).toBeInTheDocument();
    expect(within(menu as HTMLElement).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "About",
      "FAQ",
      "Game modes",
      "How to play",
      // Added 2026-08-12 beside How to play, which is the pair it belongs to.
      // Contact deliberately did NOT join this nav -- it is footer-only -- so
      // this list is also the assertion that it stayed there.
      "Strategy",
    ]);
  });

  it("marks the open page with aria-current, the way the wide nav already does", async () => {
    render(<InfoTopBar />);
    await openMenu();

    const menu = document.getElementById("info-nav-menu") as HTMLElement;
    const current = within(menu).getAllByRole("link", { current: "page" });

    expect(current.map((link) => link.textContent)).toEqual(["FAQ"]);
    // aria-selected is an option's attribute and these are not options.
    expect(menu.querySelector("[aria-selected]")).toBeNull();
  });

  it("returns focus to the trigger when Escape closes it under the keyboard", async () => {
    const user = userEvent.setup();
    render(<InfoTopBar />);
    await openMenu();

    const menu = document.getElementById("info-nav-menu") as HTMLElement;
    within(menu).getByRole("link", { name: "About" }).focus();

    await user.keyboard("{Escape}");

    // The panel unmounts on close, so without the restore focus lands on
    // <body> and the next Tab restarts from the top of the document.
    expect(document.getElementById("info-nav-menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Info pages" })).toHaveFocus();
  });
});
