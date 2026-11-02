# FB-279 — Founders get a message on their phone

**Status:** Done · **Kind:** medium · **Budget:** $25 · **Rough date:** 9 November 2026 · **Pilot step:** 8 · **Raised by:** John, 28 October 2026 (the factory pilot, `docs/prd/factory-pilot-release.md`) · One ticket = one branch = one PR.

## Why

John hears about factory work on his phone, through Telegram. A founder only finds out by opening
the studio. John asked for founders to get phone messages too (28 October).

## What to do

When one of a founder's cards needs them (finished, stuck, or sent back to them), their phone gets a
short message in plain English with a link to the card. No dollar figures, and none of the lines
written for John. A founder hears only about their own venture.

**The channel (John, 28 October): the studio's own phone notifications, with email as the
fallback.**

- **Notifications from the studio itself.** The founder adds the studio to their phone's home screen
  and switches notifications on. Nothing goes through an outside messaging service.
- **Email for anyone who hasn't switched them on,** or whose phone no longer accepts them. The same
  short message, sent to the founder's sign-in address.
- Never both for the same card: a founder whose notification was delivered gets no email.

**Start from what exists.** The studio already installs to a phone's home screen (FB-141) and sends
push notifications (`lib/push.ts`, `lib/push-send.ts`, `lib/push-store.ts`, `lib/webpush.ts`, with an
offer to switch them on in `lib/push-offer.ts`). This ticket adds factory cards as a reason to send
one, and the email fallback, which the studio does not have yet: it needs a way to send email (for
example the same Google Workspace sending the website uses), set up by John.

## Decisions (John, 30 October 2026)

- **Email goes through Google Workspace,** as john@bruntsfield.capital, with its own app password.
  It shows as from "Foundry Studio <john@bruntsfield.capital>".
- **The settings use the website's names:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and
  `SMTP_FROM`. John sets them on production himself. Never print, log or commit their values.
- **Production only.** Staging has no email settings and must never send email. With no settings,
  the studio sends no email, writes one plain line in its log saying so, and nothing fails.
- **ARCA's founder for the demo** signs in as arca.founder@bruntsfield.capital, an alias of
  john@bruntsfield.capital, so the demo's emails reach John.
- **Tests never send real email.** They use a fake mail server.
- Copy this section into `docs/tickets/FB-279-founder-phone-messages.md` in the same pull request.

## Before it works on production

- **Load `db/014_founder_messages.sql` on production's database.** Production's schema is kept by
  hand on Supabase, so nothing loads it there on its own (staging and previews load it before they
  deploy). Until it is loaded, no card message is sent, and each card writes one line in the log
  saying why.
- **Set the five `SMTP_*` settings on production.** Until then, a founder whose phone did not take
  the notification gets nothing, and the log says the studio has no email settings.
- Email is sent only on Railway's `production` environment. If production's environment has
  another name, no email is sent, and the log names the environment it saw.

## Done when

- [x] A finished card on ARCA sends exactly one message to ARCA's founder, and none to anyone else.
- [x] With notifications on, it arrives as a notification and no email is sent. With them off, it
  arrives as an email instead.
- [x] A test proves a founder never gets a message about another venture.
- [x] A founder can switch the messages off.
- [ ] Every command in `CLAUDE.md` `## Checks` passes. On the planning box, every command but two
  passed. `test:e2e` and `test:e2e:degraded` failed there on the Memory page and the phone pocket,
  because Chromium on that box closes pages; the same tests fail the same way on `main` before this
  work. CI, which runs both, decides this box.
