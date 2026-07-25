import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The opt-in DB integration tests (RUN_DB_INTEGRATION_TESTS=1) do real
    // network round trips to Supabase -- anonymous sign-in plus a handful of
    // RPCs per test -- which routinely exceeds vitest's 5s default and fails
    // them as timeouts rather than on their assertions. Costs the default
    // suite nothing: those are pure functions that finish in milliseconds, and
    // a timeout only ever applies to a test that's already hanging.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
