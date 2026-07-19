import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relativeTime";

const NOW = new Date("2026-07-19T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("reports seconds-old timestamps as 'just now'", () => {
    expect(formatRelativeTime("2026-07-19T11:59:45.000Z", NOW)).toBe("just now");
  });

  it("formats minutes ago", () => {
    expect(formatRelativeTime("2026-07-19T11:45:00.000Z", NOW)).toBe("15 minutes ago");
  });

  it("formats a single hour ago", () => {
    expect(formatRelativeTime("2026-07-19T11:00:00.000Z", NOW)).toBe("1 hour ago");
  });

  it("formats hours ago", () => {
    expect(formatRelativeTime("2026-07-19T05:00:00.000Z", NOW)).toBe("7 hours ago");
  });

  it("formats a day ago as 'yesterday'", () => {
    expect(formatRelativeTime("2026-07-18T12:00:00.000Z", NOW)).toBe("yesterday");
  });

  it("formats multiple days ago", () => {
    expect(formatRelativeTime("2026-07-15T12:00:00.000Z", NOW)).toBe("4 days ago");
  });
});
