import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import { afterEach, vi } from "vitest";

// Testing Library auto-cleans only when `afterEach` is a global, which it isn't
// here -- this repo runs vitest without `globals: true`, so the hooks are
// imported. Without this, every test in a file renders into the same document
// and `getByRole` starts matching the previous test's markup.
afterEach(cleanup);

// `lib/i18n/navigation` calls next-intl's `createNavigation()` at MODULE SCOPE,
// and that reaches for the whole of `next/navigation` (`redirect`,
// `permanentRedirect`, `useRouter`, …) plus a `NextIntlClientProvider` for the
// active locale. Neither exists in jsdom, so importing any component that links
// somewhere -- which is most of them -- threw before the first test could run.
//
// The stand-in is global rather than per-file because the alternative is the
// same block copied into every suite that happens to render a link, and the
// thing under test is never the prefixing itself: that is next-intl's job, and
// `composedMiddleware.test.ts` plus the live locale checks cover it.
//
// `usePathname` DELEGATES to `next/navigation`, so the suites that drive
// active-tab and active-link logic by mocking that module keep working
// untouched: the component asks this module, this module asks the one the test
// already controls. The real one strips the locale prefix and a mocked one
// never adds it, so both agree on an unprefixed path.
//
// Every lookup is LAZY and guarded, and that is the load-bearing detail rather
// than defensiveness. Those suites install *partial* mocks of `next/navigation`
// -- one exports only `usePathname`, another only `useRouter` -- and vitest's
// mock is a proxy that THROWS on any export the factory did not return. So
// destructuring up front takes down the very files this exists to rescue, and
// the failure looks like a mocking bug rather than a missing export.
type NavigationModule = Record<string, unknown>;

/** A function export from the (possibly partially mocked) module, or a fallback. */
function navFn<T extends (...args: never[]) => unknown>(
  nav: NavigationModule,
  name: string,
  fallback: T,
): T {
  try {
    const value = nav[name];
    return typeof value === "function" ? (value as T) : fallback;
  } catch {
    // The export is absent from a partial mock; the proxy threw on access.
    return fallback;
  }
}

// The other half of the same problem: components read their strings through
// `useTranslations`, which throws without a `NextIntlClientProvider` above it,
// and the dom suites render components bare on purpose -- that is what makes
// them tests of a component rather than of a page.
//
// Rather than wrap every render, the hooks are backed by the REAL English
// catalogue through next-intl's own `createTranslator`. Two things follow, and
// both are why this is a stand-in rather than a stub: the strings are the ones
// that ship, so `getByRole("tab", { name: "Daily" })` keeps meaning what it
// says; and ICU is really evaluated, so a broken plural or a missing key fails
// here instead of in a browser.
//
// What it deliberately does NOT cover is the provider being wired up correctly
// in `app/[locale]/layout.tsx`, or any locale but English. Those are facts
// about a rendered page, and the live per-locale checks are what prove them.
vi.mock("next-intl", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const { createTranslator } = actual as {
    createTranslator: (options: {
      locale: string;
      messages: unknown;
      namespace?: string;
    }) => unknown;
  };
  const messages = (await import("./messages/en.json")).default;

  return {
    ...actual,
    useLocale: () => "en",
    useTranslations: (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace }),
  };
});

vi.mock("@/lib/i18n/navigation", async () => {
  const nav = (await import("next/navigation")) as NavigationModule;

  function Link({
    href,
    children,
    // Swallowed rather than forwarded: `locale` is not a DOM attribute, and
    // React would warn on every rendered link in the suite.
    locale: _locale,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    locale?: string;
    children?: ReactNode;
  }) {
    return createElement("a", { href, ...rest }, children);
  }

  return {
    Link,
    usePathname: () => navFn(nav, "usePathname", () => "/")(),
    useRouter: () => navFn(nav, "useRouter", () => ({ push: vi.fn(), replace: vi.fn() }))(),
    // Arguments are deliberately dropped rather than forwarded: nothing in the
    // dom tier asserts on a redirect's target, and typing the pass-through
    // through `navFn`'s generic buys nothing for a call no test makes.
    redirect: () => navFn(nav, "redirect", () => undefined)(),
    permanentRedirect: () => navFn(nav, "permanentRedirect", () => undefined)(),
    getPathname: ({ href }: { href: string }) => href,
  };
});
