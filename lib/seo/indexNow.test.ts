import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  INDEXNOW_KEY,
  buildPayload,
  chunkUrls,
  describeResponse,
  foreignUrls,
  parseSitemapEntries,
  planSubmission,
  type SubmissionState,
} from "./indexNow";

// Every failure this file guards is silent. A mispaired <lastmod>, a key that
// no longer matches its filename, an origin mismatch -- none of them throws,
// none of them changes a rendered page, and the only symptom is that URLs stop
// being submitted, which looks exactly like URLs being submitted successfully.

const ORIGIN = "https://driverpit.app";

/** A sitemap in the shape app/sitemap.ts actually emits: most entries carry no <lastmod>. */
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url>
<loc>https://driverpit.app</loc>
<lastmod>2026-08-14T00:00:00.000Z</lastmod>
<changefreq>daily</changefreq>
<priority>1</priority>
</url>
<url>
<loc>https://driverpit.app/faq</loc>
<changefreq>monthly</changefreq>
<priority>0.7</priority>
</url>
<url>
<loc>https://driverpit.app/archive/2026-08-13</loc>
<lastmod>2026-08-13T00:00:00.000Z</lastmod>
<changefreq>yearly</changefreq>
<priority>0.6</priority>
</url>
</urlset>`;

describe("parseSitemapEntries", () => {
  it("reads each entry's own lastmod, and null where there is none", () => {
    // THE assertion in this file. `/faq` carries no <lastmod>, so a parser that
    // scans for <loc> and <lastmod> independently and zips the two lists hands
    // `/faq` the NEXT entry's date -- and then `planSubmission` resubmits a
    // static page every day while the archive day page it stole the date from
    // silently never moves. Both halves stay plausible in a log.
    expect(parseSitemapEntries(SITEMAP)).toEqual([
      { url: "https://driverpit.app", lastModified: "2026-08-14T00:00:00.000Z" },
      { url: "https://driverpit.app/faq", lastModified: null },
      {
        url: "https://driverpit.app/archive/2026-08-13",
        lastModified: "2026-08-13T00:00:00.000Z",
      },
    ]);
  });

  it("returns nothing rather than throwing on junk", () => {
    // A sitemap that 500s or serves an HTML error page should produce an empty
    // plan the runner can report, not a stack trace in a scheduled job.
    expect(parseSitemapEntries("<html><body>502 Bad Gateway</body></html>")).toEqual([]);
  });
});

describe("planSubmission", () => {
  const entries = parseSitemapEntries(SITEMAP);

  it("submits everything when there is no previous state", () => {
    const plan = planSubmission(entries, null);
    expect(plan.urls).toHaveLength(3);
    expect(plan.reason).toContain("no previous state");
  });

  it("submits nothing when the sitemap has not moved", () => {
    const plan = planSubmission(entries, planSubmission(entries, null).nextState);
    expect(plan.urls).toEqual([]);
    expect(plan.reason).toContain("nothing changed");
  });

  it("submits the daily page again when its lastmod rolls over", () => {
    const yesterday: SubmissionState = {
      ...planSubmission(entries, null).nextState,
      "https://driverpit.app": "2026-08-13T00:00:00.000Z",
    };

    expect(planSubmission(entries, yesterday).urls).toEqual(["https://driverpit.app"]);
  });

  it("submits an archive day the run after it becomes indexable", () => {
    // A day enters the sitemap only once somebody completes a board on it, which
    // can be well after the date it carries. That is why the diff is against
    // stored state and not a "lastmod within N days" window -- a window would
    // skip precisely the late arrivals.
    const before: SubmissionState = {
      "https://driverpit.app": "2026-08-14T00:00:00.000Z",
      "https://driverpit.app/faq": "",
    };

    expect(planSubmission(entries, before).urls).toEqual([
      "https://driverpit.app/archive/2026-08-13",
    ]);
  });

  it("does not resubmit a page that never declared a lastmod", () => {
    // `/faq` and the driver pages are in this group. Treating "no date" as
    // "changed" would resubmit most of the sitemap every single day, which is
    // how a push protocol earns a 429.
    const plan = planSubmission(entries, planSubmission(entries, null).nextState);
    expect(plan.urls).not.toContain("https://driverpit.app/faq");
  });
});

describe("buildPayload", () => {
  it("sends the bare host, not the origin", () => {
    // The endpoint compares every submitted URL's host against this field and
    // answers 422 for the WHOLE batch on a mismatch. "https://driverpit.app" is
    // not a host, so it would reject every URL under it.
    expect(buildPayload(ORIGIN, [ORIGIN]).host).toBe("driverpit.app");
    expect(buildPayload(ORIGIN, [ORIGIN]).key).toBe(INDEXNOW_KEY);
  });
});

describe("foreignUrls", () => {
  it("catches off-origin and unparseable URLs before the batch is rejected for them", () => {
    expect(
      foreignUrls(ORIGIN, [
        "https://driverpit.app/faq",
        "https://driver-pit.vercel.app/faq",
        "not a url",
      ]),
    ).toEqual(["https://driver-pit.vercel.app/faq", "not a url"]);
  });
});

describe("chunkUrls", () => {
  it("splits at the ceiling and returns nothing for nothing", () => {
    expect(chunkUrls([], 2)).toEqual([]);
    expect(chunkUrls(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });
});

describe("describeResponse", () => {
  it("treats 202 as success", () => {
    // It reads like a warning and is the EXPECTED answer on a first run: the
    // URLs were taken and the key is being verified. Reported as a failure, it
    // is the kind of thing that gets a working workflow deleted.
    expect(describeResponse(202).ok).toBe(true);
    expect(describeResponse(200).ok).toBe(true);
    expect(describeResponse(403).ok).toBe(false);
    expect(describeResponse(429).ok).toBe(false);
  });
});

describe("the key file", () => {
  it("exists at public/<key>.txt and contains exactly the key", () => {
    // The filename IS the key, so these are a pair nothing type-checks. Rotate
    // the constant without renaming the file (or the reverse) and every
    // submission comes back 403 while the site is otherwise perfectly fine.
    const contents = readFileSync(
      join(process.cwd(), "public", `${INDEXNOW_KEY}.txt`),
      "utf8",
    );

    expect(contents.trim()).toBe(INDEXNOW_KEY);
  });

  it("uses a key the protocol accepts", () => {
    // 8-128 chars, letters/digits/dashes only. A key outside that is rejected
    // with the same 403 as a missing file, which sends the reader to the wrong
    // half of the problem.
    expect(INDEXNOW_KEY).toMatch(/^[A-Za-z0-9-]{8,128}$/);
  });
});
