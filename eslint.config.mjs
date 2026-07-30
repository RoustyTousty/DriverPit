import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Audit 2026-07-29 §0.5 / §2.6. Until now there was deliberately no ESLint
// config here -- and 17 `eslint-disable` comments suppressing a rule that never
// ran. A suppression nothing checks is not a policy, it is a claim about one;
// the count moved 12 -> 17 on its own between two audits, and every one of them
// was unverifiable in either direction.
//
// The decision was made against the real numbers rather than the feeling, by
// running each candidate ruleset over the tree first:
//
//   react-hooks/rules-of-hooks             0 violations
//   react-hooks/exhaustive-deps           13 -- every one already annotated
//   @typescript-eslint/no-explicit-any     1 -- already annotated
//   @next/next (recommended)               1 real + 1 already annotated
//   react-hooks "recommended-latest"      30 -- NOT adopted, see below
//
// So the two classic hook rules cost nothing to switch on: the codebase already
// complies, and turning them on converts 13 decorative comments into 13
// reviewed decisions. Two more turned out to suppress nothing at all and are
// gone -- which is a thing that could only be learned by running the rule.
//
// What is NOT adopted, deliberately: eslint-plugin-react-hooks v7's full
// `recommended-latest` preset, which bundles the React Compiler diagnostics
// (set-state-in-effect, purity, refs, immutability). Measured at 30 violations,
// and they land on patterns this codebase chose on purpose and documents --
// GuessAnnouncer's whole design is state set from an effect, useLightsCountdown
// reads Date.now() in render (audit §1.7, latent and accepted). Adopting it
// would mean 30 new suppressions on day one, which is the exact shape of the
// problem this config exists to end. It is a separate decision, to be taken
// against its own numbers.
//
// No style or formatting rules either, for the same reason: this repo has never
// had them, `tsc --noEmit` is the type authority, and inventing a house style
// inside a lint adoption is how a lint step becomes something people skip.

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "drizzle/**",
      "public/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,mts,mjs}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@typescript-eslint": tseslint.plugin,
      "@next/next": nextPlugin,
    },
    // The ratchet §0.5 asks for. A suppression that stops being needed now
    // fails the build, so the count can only fall unless someone deliberately
    // adds one -- which is the opposite of "the number moves in one direction
    // on its own".
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      ...nextPlugin.configs.recommended.rules,

      // A hook called conditionally is a real bug, not a style opinion.
      "react-hooks/rules-of-hooks": "error",
      // Error rather than warn: a warning in a check that gates CI is a check
      // nobody reads. The 13 existing suppressions each carry their reason at
      // the call site; a 14th now has to be written on purpose.
      "react-hooks/exhaustive-deps": "error",

      // CLAUDE.md already states "No `any`" under Conventions. This is that
      // rule, enforced -- one pre-existing site, in a test, annotated.
      "@typescript-eslint/no-explicit-any": "error",

      // A Pages Router rule: it wants `beforeInteractive` scripts in
      // `pages/_document`. This app is App Router only (there is no `pages/`),
      // where the root layout is exactly where such a script belongs -- so the
      // rule can only ever produce a false positive here. Off with a reason
      // rather than suppressed at the one call site, since any future one would
      // be equally false.
      "@next/next/no-before-interactive-script-outside-document": "off",
    },
  },
];
