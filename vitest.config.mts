import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

// The opt-in DB integration tests (RUN_DB_INTEGRATION_TESTS=1) do real network
// round trips to Supabase -- anonymous sign-in plus a handful of RPCs per test
// -- which routinely exceeds vitest's 5s default and fails them as timeouts
// rather than on their assertions. Costs the other tiers nothing: they are pure
// functions and DOM renders that finish in milliseconds, and a timeout only ever
// applies to a test that's already hanging.
const TIMEOUTS = { testTimeout: 30_000, hookTimeout: 30_000 };

export default defineConfig({
  // Components import through the `@/` alias tsconfig.json declares; vitest does
  // not read tsconfig paths on its own.
  resolve: { alias: { "@": repoRoot } },
  // tsconfig says `jsx: "preserve"` because Next does the transform. esbuild
  // follows tsconfig, so without this it hands vitest raw JSX.
  esbuild: { jsx: "automatic" },
  test: {
    // Two tiers, split by environment rather than by directory (audit
    // 2026-07-29 §2.6). Everything under `lib/` and `scripts/` is pure logic and
    // runs in node, as it always has; `.test.tsx` files render real components
    // in jsdom.
    //
    // Split because the environments genuinely differ -- a jsdom global for the
    // node suites would be a lie about what they exercise, and it costs startup
    // on every pure run -- and because `npm test -- --project=dom` is then the
    // fast loop while working on a component.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
          ...TIMEOUTS,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          setupFiles: ["./vitest.setup.dom.ts"],
          ...TIMEOUTS,
        },
      },
    ],
  },
});
