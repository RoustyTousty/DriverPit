// Writes app/flag-icons.subset.css. Run after changing COUNTRY_CODES
// (lib/game/flags.ts) or bumping the `flag-icons` dependency:
//
//   npm run flags:subset
//
// The reconciliation logic lives in ./flagSubset.ts, which has no side effects
// at import so the test can regenerate and diff without writing anything. This
// file is only the write -- same split as releaseGuards.ts / seed.ts.

import { writeFileSync } from "node:fs";

import {
  assertFlagAssetsExist,
  buildFlagSubsetCss,
  readFlagIconsVersion,
  readUpstreamCss,
  subsetCodes,
  SUBSET_CSS_PATH,
} from "./flagSubset";

function main() {
  const version = readFlagIconsVersion();
  const codes = subsetCodes();

  assertFlagAssetsExist(codes);
  const css = buildFlagSubsetCss(readUpstreamCss(), version);
  writeFileSync(SUBSET_CSS_PATH, css, "utf8");

  console.log(
    `Wrote ${SUBSET_CSS_PATH}\n` +
      `  flag-icons@${version}, ${codes.length} countries, 4x3 only, ${css.length} bytes\n` +
      `  ${codes.join(" ")}`,
  );
}

main();
