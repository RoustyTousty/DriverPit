# Branded auth emails

The HTML next to this file is the source of truth for DriverPit's Supabase Auth
emails. Supabase stores them in a dashboard textarea, which is not a place a
template can be reviewed or diffed — so it edits here and gets pasted there.

## Two separate things, and only one of them is the templates

Branding an auth email has two halves, and doing only the first leaves it still
looking like a Supabase email:

| | What it controls | Where |
|---|---|---|
| **Templates** | the body: layout, copy, colours, logo | Authentication → Emails → Templates |
| **Custom SMTP** | the **sender**: `DriverPit <no-reply@yourdomain>` instead of `noreply@mail.app.supabase.io`, and the deliverability that goes with it | Authentication → Emails → SMTP Settings |

**The sender address cannot be changed on Supabase's built-in email service.** It
is documented as being for testing only, it is rate limited to a couple of
messages per hour for the whole project, and that limit is **not raisable** —
the field that raises it only unlocks once custom SMTP is configured. So a
project on the built-in sender has two symptoms at once: emails that say
Supabase, and emails that mostly don't arrive.

Any SMTP provider works. The free tiers that fit a project this size are Resend,
Brevo, Postmark and Mailgun; all of them need you to verify a sending domain
(SPF + DKIM DNS records) before they will send as `@yourdomain`.

Once SMTP is set, set the sender name to `DriverPit` in the same panel — that is
the field that puts the brand in the inbox list, which is the only part of an
email most people ever read.

## Installing a template

Authentication → Emails → Templates → pick the template → paste the file's
contents into the message body → also set the subject line:

| File | Template | Subject |
|---|---|---|
| `confirm-signup.html` | Confirm signup | `Confirm your DriverPit account` |
| `confirm-email-change.html` | Change Email Address | `Confirm your DriverPit account` |
| `reset-password.html` | Reset password | `Reset your DriverPit password` |
| `magic-link.html` | Magic Link | `Your DriverPit sign-in link` |

**Do `confirm-signup.html` and `confirm-email-change.html` both.** Which one
actually fires on sign-up is not obvious: a guest upgrading through `AuthPanel`
calls `updateUser({ email, password })` on an *existing* anonymous row, so GoTrue
treats it as adding/changing an address rather than as a signup, and the project's
"Secure email change" setting moves the answer again. Brand both and the question
stops mattering. Their copy is deliberately near-identical for the same reason.

`magic-link.html` is included even though nothing in the app calls
`signInWithOtp()` — the template is live whether or not we use it.

## What not to change

- **`{{ .ConfirmationURL }}` must stay exactly as it is.** It is GoTrue's own
  `/auth/v1/verify?...&redirect_to=...` link, and `redirect_to` is what carries
  the flow through `/auth/callback` (see `lib/auth/oauthCallback.ts`). Hand-building
  a link from `{{ .Token }}` breaks the PKCE exchange and the `?auth=<flow>`
  arrival message with it.
- **Keep the plain-text link under the button.** Some clients strip or rewrite
  button links, and this flow has no support desk behind it.
- **Keep the "same browser" line** on the confirm and reset templates. PKCE
  stores its code verifier in the browser that *started* the flow, so a link
  opened elsewhere fails — and `/auth/reset-password` says the same thing at the
  other end. It is the single most common way these links "don't work".

## Variables available

`{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .TokenHash }}`, `{{ .SiteURL }}`,
`{{ .Email }}`, `{{ .NewEmail }}`, `{{ .RedirectTo }}`, `{{ .Data }}`.

## The logo

Every template loads it from `{{ .SiteURL }}/driverpit-banner.png` — the file in
`public/`, so it needs no separate hosting and stays in step with the site.

Two consequences:

- **Site URL must be the deployed origin** (Authentication → URL Configuration).
  Pointed at `localhost`, the logo is a broken image in every recipient's inbox.
  If you want branded email while Site URL is still local, hardcode the domain in
  the `src` instead.
- **Images are blocked by default in most clients**, so the `<img>` carries
  `alt="DriverPit"` styled in accent orange at 22px bold. With images off it reads
  as an orange wordmark rather than a grey box — that fallback is doing real work
  and shouldn't be stripped.

Everything is table-based with inline styles and no `<style>` block, because
Gmail drops embedded stylesheets. The palette is `app/globals.css`'s tokens as
literals (`#0B0D10`, `#14181D`, `#262C35`, `#E7EAEE`, `#8A929E`, `#FF6A00`);
email can't read CSS variables, so **these are a hand-copy and will not follow a
token change** — if the site's palette moves, these four files move by hand.
