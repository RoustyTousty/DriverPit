import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library auto-cleans only when `afterEach` is a global, which it isn't
// here -- this repo runs vitest without `globals: true`, so the hooks are
// imported. Without this, every test in a file renders into the same document
// and `getByRole` starts matching the previous test's markup.
afterEach(cleanup);
