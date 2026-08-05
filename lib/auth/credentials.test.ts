import { describe, expect, it } from "vitest";

import {
  PASSWORD_MIN_LENGTH,
  describeAuthError,
  normalizeEmail,
  validateEmail,
  validateNewPassword,
} from "./credentials";

describe("normalizeEmail", () => {
  it("trims and lowercases, so one address is one account", () => {
    // The whole point: GoTrue stores the folded form, so signing up as
    // "Me@Example.com" and signing in as "me@example.com" must be the same
    // account on our side too.
    expect(normalizeEmail("  Me@Example.COM ")).toBe("me@example.com");
  });
});

describe("validateEmail", () => {
  it("accepts ordinary addresses, including plus tags and subdomains", () => {
    for (const email of ["a@b.co", "player+daily@mail.example.com", "  Player@Example.com  "]) {
      expect(validateEmail(email)).toBeNull();
    }
  });

  it("names the problem instead of failing silently", () => {
    expect(validateEmail("")).toMatch(/enter your email/i);
    expect(validateEmail("   ")).toMatch(/enter your email/i);
    expect(validateEmail("player")).toMatch(/email address/i);
    expect(validateEmail("player@localhost")).toMatch(/email address/i);
    expect(validateEmail("player @example.com")).toMatch(/email address/i);
    expect(validateEmail(`${"a".repeat(250)}@example.com`)).toMatch(/too long/i);
  });
});

describe("validateNewPassword", () => {
  it("accepts anything at or above the floor", () => {
    expect(validateNewPassword("a".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(validateNewPassword("a much longer passphrase")).toBeNull();
  });

  it("rejects empty and short passwords, quoting the floor it enforces", () => {
    expect(validateNewPassword("")).toMatch(/choose a password/i);
    expect(validateNewPassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  });
});

describe("describeAuthError", () => {
  it("sends a returning player to the other tab when the email is taken", () => {
    // The most likely failure in the whole flow: a returning player arrives on
    // a guest session, which opens on "Create account". GoTrue's own message
    // ("User already registered") never mentions signing in.
    const message = describeAuthError({ code: "email_exists", message: "User already registered" }, "fallback");
    expect(message).toMatch(/Sign in/);
  });

  it("keeps the server's message when we have nothing better to say", () => {
    // weak_password is the case that matters here: the Supabase project may
    // demand more than PASSWORD_MIN_LENGTH, and only the server knows what.
    expect(
      describeAuthError({ code: "weak_password", message: "Password should contain a symbol" }, "fallback"),
    ).toBe("Password should contain a symbol");
  });

  it("falls back when there is no error, no code and no message", () => {
    expect(describeAuthError(null, "fallback")).toBe("fallback");
    expect(describeAuthError({}, "fallback")).toBe("fallback");
    expect(describeAuthError({ message: "   " }, "fallback")).toBe("fallback");
  });
});
