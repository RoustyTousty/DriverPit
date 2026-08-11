import { parse } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";

import {
  batchKeys,
  flatten,
  planTranslation,
  sourceHash,
  unflatten,
  validateTranslation,
  type FlatCatalogue,
  type Manifest,
} from "./translationPlan";

// The generated catalogues are never read by a human before they ship, so the
// only thing standing between a bad translation and a live page is the
// validator below. These tests are mostly about it.

describe("flatten / unflatten", () => {
  it("round-trips a nested catalogue", () => {
    const nested = { nav: { links: { faq: "FAQ" }, menu: "Menu" }, site: { title: "DriverPit" } };
    const flat = flatten(nested);
    expect(flat).toEqual({ "nav.links.faq": "FAQ", "nav.menu": "Menu", "site.title": "DriverPit" });
    expect(unflatten(flat, Object.keys(flat))).toEqual(nested);
  });

  it("writes keys in ENGLISH's order, not the translation's", () => {
    // A generated file that reshuffles itself every run produces a diff nobody
    // reads, which is exactly where a real change hides.
    const order = ["a.one", "a.two", "b"];
    const flat: FlatCatalogue = { b: "B", "a.two": "TWO", "a.one": "ONE" };
    expect(JSON.stringify(unflatten(flat, order))).toBe(
      JSON.stringify({ a: { one: "ONE", two: "TWO" }, b: "B" }),
    );
  });

  it("drops keys the order does not mention", () => {
    // This is how a key deleted from English leaves the generated catalogues.
    expect(unflatten({ keep: "y", gone: "n" }, ["keep"])).toEqual({ keep: "y" });
  });
});

describe("planTranslation", () => {
  const english = { greeting: "Hello", farewell: "Bye" };
  const upToDate: Manifest = {
    es: { greeting: sourceHash("Hello"), farewell: sourceHash("Bye") },
  };

  it("translates nothing when every source hash still matches", () => {
    const plan = planTranslation(
      english,
      { es: { greeting: "Hola", farewell: "Adiós" } },
      upToDate,
      "stale",
    );
    const es = plan.find((p) => p.locale === "es")!;
    expect(es.translate).toEqual([]);
    expect(es.current).toBe(2);
  });

  it("re-translates a key whose ENGLISH changed, not one whose translation did", () => {
    // The manifest is keyed on the source for exactly this reason: a hand-edit
    // to the Spanish must not trigger a re-translation that overwrites it, and a
    // one-word edit to the English must.
    const plan = planTranslation(
      { greeting: "Hello there", farewell: "Bye" },
      { es: { greeting: "Hola", farewell: "hasta luego, editado a mano" } },
      upToDate,
      "stale",
    );
    expect(plan.find((p) => p.locale === "es")!.translate).toEqual(["greeting"]);
  });

  it("translates a key that is missing from the locale", () => {
    const plan = planTranslation(english, { es: { greeting: "Hola" } }, upToDate, "stale");
    expect(plan.find((p) => p.locale === "es")!.translate).toEqual(["farewell"]);
  });

  it("translates everything in `all` mode, which is the wholesale-regenerate switch", () => {
    const plan = planTranslation(english, { es: { greeting: "Hola" } }, upToDate, "all");
    expect(plan.find((p) => p.locale === "es")!.translate).toEqual(["greeting", "farewell"]);
  });

  it("removes keys English no longer has, even on a run with nothing to translate", () => {
    // Deletion has to be independent of translation or a renamed key leaves its
    // old translation behind forever and the catalogues drift out of parity.
    const plan = planTranslation(
      english,
      { es: { greeting: "Hola", farewell: "Adiós", ancient: "obsoleto" } },
      upToDate,
      "stale",
    );
    const es = plan.find((p) => p.locale === "es")!;
    expect(es.remove).toEqual(["ancient"]);
    expect(es.translate).toEqual([]);
  });

  it("never plans work for the source locale", () => {
    expect(planTranslation(english, {}, {}, "all").map((p) => p.locale)).not.toContain("en");
  });
});

describe("validateTranslation — the safety net", () => {
  const ok = (english: string, translated: string) =>
    validateTranslation(parse, english, translated);

  it("accepts a faithful translation", () => {
    expect(ok("Puzzle #{number} was {driver}.", "El reto n.º {number} era {driver}.")).toEqual({
      ok: true,
    });
  });

  it("accepts reordered placeholders — word order differs per language", () => {
    expect(ok("{a} then {b}", "{b}, y antes {a}").ok).toBe(true);
  });

  it("REJECTS a translated placeholder name", () => {
    // The failure this whole module exists for: `{driver}` helpfully rendered
    // as `{conductor}` renders the literal word to the reader.
    const result = ok("Answer: {driver}", "Respuesta: {conductor}");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("placeholder mismatch");
  });

  it("REJECTS a dropped placeholder", () => {
    expect(ok("{solved} of {completed}", "algunos de {completed}").ok).toBe(false);
  });

  it("REJECTS an invented placeholder", () => {
    expect(ok("Hello {name}", "Hola {name} {surname}").ok).toBe(false);
  });

  it("REJECTS structurally broken ICU rather than writing it", () => {
    const result = ok("Hello {name}", "Hola {name");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("not valid ICU");
  });

  it("REJECTS an empty string", () => {
    expect(ok("Hello", "   ").ok).toBe(false);
  });

  it("keeps plural placeholders intact through a real plural translation", () => {
    expect(
      ok(
        "{driver} won {wins} {wins, plural, one {grand prix} other {grands prix}}.",
        "{driver} ganó {wins} {wins, plural, one {gran premio} other {grandes premios}}.",
      ),
    ).toEqual({ ok: true });
  });

  it("allows a language to use a different set of plural categories", () => {
    // Plural CATEGORIES are language-specific — the names are the contract, the
    // category set is not. A validator that demanded identical categories would
    // reject correct Polish and correct Russian.
    expect(
      ok(
        "{n, plural, one {# day} other {# days}}",
        "{n, plural, one {# dzień} few {# dni} many {# dni} other {# dnia}}",
      ),
    ).toEqual({ ok: true });
  });

  it("does not mistake prose for a placeholder name", () => {
    // Literal text nodes carry a `value` too; counting those would make every
    // translation look like a mismatch.
    expect(ok("The answer was clear", "La respuesta era clara")).toEqual({ ok: true });
  });
});

describe("batchKeys", () => {
  it("splits into batches of at most the given size", () => {
    expect(batchKeys(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("returns nothing for no keys", () => {
    expect(batchKeys([], 10)).toEqual([]);
  });

  it("refuses a batch size that would never make progress", () => {
    expect(() => batchKeys(["a"], 0)).toThrow();
  });
});
