import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdSlot } from "./AdSlot";
import { AdSlotGate } from "./AdSlotGate";

// The ad slot reserves 100px of the page whether or not an ad is in it. That
// reservation is only worth having while an ad might still arrive, and every
// case below is one where it can't -- so what is pinned here is a count of
// elements on screen, which is a fact about a render rather than about a value.
//
// Each of these fails against the previous version, which showed a grey
// "Advertisement" box in all three situations.

const useAdConsentMock = vi.hoisted(() => vi.fn());
const useActiveMatchMock = vi.hoisted(() => vi.fn());

vi.mock("./useAdConsent", () => ({ useAdConsent: useAdConsentMock }));
vi.mock("@/components/ads/useAdConsent", () => ({ useAdConsent: useAdConsentMock }));
vi.mock("@/components/duel/ActiveMatchContext", () => ({ useActiveMatch: useActiveMatchMock }));

function configureAdsense() {
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT = "ca-pub-0000000000000000";
  process.env.NEXT_PUBLIC_ADSENSE_SLOT = "1234567890";
}

function unconfigureAdsense() {
  delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  delete process.env.NEXT_PUBLIC_ADSENSE_SLOT;
}

beforeEach(() => {
  useAdConsentMock.mockReturnValue("granted");
  useActiveMatchMock.mockReturnValue({ active: false });
  // A working ad library by default: push exists and does nothing, which is
  // what "the request went out" looks like from this component.
  window.adsbygoogle = [];
});

afterEach(() => {
  unconfigureAdsense();
  delete window.adsbygoogle;
});

describe("AdSlotGate", () => {
  it("renders nothing at all when AdSense isn't configured", () => {
    unconfigureAdsense();

    const { container } = render(<AdSlotGate />);

    // Not "renders a placeholder" -- renders NO element, so the layout closes
    // up rather than holding a hole for an ad that can never arrive.
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the slot once both env vars are set", () => {
    // The control case, and it isn't optional: without it the assertion above
    // passes just as well for a component that renders nothing ever.
    configureAdsense();

    render(<AdSlotGate />);

    expect(document.querySelector("ins.adsbygoogle")).toBeInTheDocument();
  });

  it("still yields the screen to a live match", () => {
    configureAdsense();
    useActiveMatchMock.mockReturnValue({ active: true });

    const { container } = render(<AdSlotGate />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("AdSlot", () => {
  it("collapses when AdSense reports the unit unfilled", async () => {
    // The common case on a new site: the request succeeds, there is simply
    // nothing to serve, and AdSense says so by stamping the attribute
    // asynchronously. The <ins> is left empty, so a slot that kept its height
    // here would be a full-size box containing nothing.
    configureAdsense();
    render(<AdSlot />);

    const ins = document.querySelector("ins.adsbygoogle");
    expect(ins).toBeInTheDocument();

    ins!.setAttribute("data-ad-status", "unfilled");

    await waitFor(() => expect(document.querySelector("ins.adsbygoogle")).not.toBeInTheDocument());
    expect(screen.queryByText("Advertisement")).not.toBeInTheDocument();
  });

  it("keeps the space when AdSense reports the unit filled", async () => {
    configureAdsense();
    render(<AdSlot />);

    document.querySelector("ins.adsbygoogle")!.setAttribute("data-ad-status", "filled");

    // Nothing to wait for, so give the observer a turn before asserting it
    // didn't fire -- an assertion that passes instantly would pass against a
    // component that collapsed a tick later.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("ins.adsbygoogle")).toBeInTheDocument();
  });

  it("collapses when the ad library never loaded", async () => {
    // What an ad blocker looks like from in here: adsbygoogle.push isn't a
    // function, so no request is ever made and nothing is coming.
    configureAdsense();
    delete window.adsbygoogle;
    Object.defineProperty(window, "adsbygoogle", { value: { push: undefined }, configurable: true, writable: true });

    const { container } = render(<AdSlot />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
