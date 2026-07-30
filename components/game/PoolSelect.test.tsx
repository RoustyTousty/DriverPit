import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PoolSelect, type PoolSelectOption } from "./PoolSelect";

// Audit 2026-07-29 §4.5 and §4.7. This control announces itself as a combobox
// with a listbox of options, and the fix was to make that promise true: full
// keyboard operation, and focus taken back when the button re-enables after the
// round it restarted.
//
// Both closed without a browser (§2.6). An ARIA promise is exactly the kind of
// claim `tsc` cannot check -- the roles are string literals either way -- so
// until now nothing in the repo could tell an operable listbox from markup that
// merely says "listbox".

const OPTIONS: PoolSelectOption[] = [
  { value: "current-season", tier: "Amateur", label: "this season", count: 22 },
  { value: "10-years", tier: "Regular", label: "last 10 years", count: 60 },
  { value: "20-years", tier: "Professional", label: "last 20 years", count: 120 },
  { value: "legacy", tier: "Legend", label: "everyone", count: 792 },
];

function setup(over: { value?: PoolSelectOption["value"]; disabled?: boolean } = {}) {
  const onChange = vi.fn();
  const view = render(
    <PoolSelect
      value={over.value ?? "10-years"}
      options={OPTIONS}
      onChange={onChange}
      disabled={over.disabled ?? false}
    />,
  );
  return { onChange, user: userEvent.setup(), view };
}

const trigger = () => screen.getByRole("combobox", { name: "Driver pool" });

describe("PoolSelect", () => {
  it("opens on click and lists every pool", async () => {
    const { user } = setup();

    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(4);
  });

  it("opens with the keyboard cursor on the current pool, not the top", async () => {
    const { user } = setup({ value: "20-years" });

    trigger().focus();
    await user.keyboard("{ArrowDown}");

    // Arrowing starts where the player already is.
    const active = trigger().getAttribute("aria-activedescendant");
    expect(screen.getByRole("option", { selected: true }).id).toBe(active);
  });

  it("selects with the keyboard alone", async () => {
    const { onChange, user } = setup();

    trigger().focus();
    await user.keyboard("{ArrowDown}"); // open, cursor on "10-years"
    await user.keyboard("{ArrowDown}"); // move to "20-years"
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("20-years");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("supports Home and End", async () => {
    const { onChange, user } = setup();

    trigger().focus();
    await user.keyboard("{ArrowDown}{End}{Enter}");
    expect(onChange).toHaveBeenCalledWith("legacy");

    await user.keyboard("{ArrowDown}{Home}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("current-season");
  });

  it("closes on Escape without changing the pool", async () => {
    const { onChange, user } = setup();

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not leave the panel orphaned open when focus tabs away", async () => {
    const { user } = setup();

    trigger().focus();
    await user.keyboard("{ArrowDown}");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");

    await user.tab();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  // §4.5's second-order bug: a browser blurs an element the moment it becomes
  // disabled, so a keyboard user lost their place every time they used this
  // control SUCCESSFULLY -- Tab restarted from the top of the page.
  it("takes focus back when the round it restarted finishes loading", async () => {
    const { user, view } = setup();

    trigger().focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    // A real browser blurs an element the moment it becomes disabled; jsdom
    // doesn't, so the blur is done explicitly here to reproduce the condition
    // the effect exists to recover from.
    trigger().blur();
    expect(document.activeElement).toBe(document.body);
    view.rerender(
      <PoolSelect value="20-years" options={OPTIONS} onChange={vi.fn()} disabled />,
    );

    view.rerender(
      <PoolSelect value="20-years" options={OPTIONS} onChange={vi.fn()} disabled={false} />,
    );
    expect(document.activeElement).toBe(trigger());
  });

  // The guard on that: a player who deliberately moved on keeps their focus.
  // Taking it back would be the worse bug.
  it("leaves focus alone if something else has claimed it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <PoolSelect value="10-years" options={OPTIONS} onChange={onChange} />
        <button type="button">somewhere else</button>
      </>,
    );

    trigger().focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    const elsewhere = screen.getByRole("button", { name: "somewhere else" });
    rerender(
      <>
        <PoolSelect value="20-years" options={OPTIONS} onChange={onChange} disabled />
        <button type="button">somewhere else</button>
      </>,
    );
    elsewhere.focus();

    rerender(
      <>
        <PoolSelect value="20-years" options={OPTIONS} onChange={onChange} disabled={false} />
        <button type="button">somewhere else</button>
      </>,
    );
    expect(document.activeElement).toBe(elsewhere);
  });

  // A mouse selection doesn't arm the restore -- there is no keyboard position
  // to put back, and stealing focus after a click is its own bug.
  it("does not grab focus after a mouse selection", async () => {
    const { user, view } = setup();

    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: /Legend/ }));

    trigger().blur();
    view.rerender(
      <PoolSelect value="legacy" options={OPTIONS} onChange={vi.fn()} disabled />,
    );
    view.rerender(
      <PoolSelect value="legacy" options={OPTIONS} onChange={vi.fn()} disabled={false} />,
    );

    expect(document.activeElement).toBe(document.body);
  });
});
