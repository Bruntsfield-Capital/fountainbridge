# FB-294 — ARCA's founder is Matthew, signing in with Google

**Status:** Done · **Size:** small · **Asked by:** John, 3 November 2026 · **Repo:** fountainbridge ·
**Branch:** `fb-294-arca-founder-is-matthew` · One ticket = one branch = one PR.

## Why

Matthew could not sign in to the studio as ARCA's founder. ARCA's founder address was
`arca.founder@bruntsfield.capital`. That is an alias on Matthew's own Google account, and Google
sign-in only accepts an account's own address, so Google would not let him in as arca.founder@. The
other way in was the studio's password sign-in (FB-092), and nobody knew that password.

So Matthew could not sign off arca #132 (ARCA-047, the sign-in line), and the live test stopped
there.

## What changes

- ARCA's founder is `matthew@bruntsfield.capital`, his own Google address (`ventures/arca.yaml`).
  The founder's name on screen stays "Founder".
- Founder notices go to that address. They read it from the same line, so nothing else changes.
- The tests, the test copy's notes (`README.md`, `harness/`) and the two helper scripts use the new
  address. The test sign-in still has a password entry, now for the new address, so the
  password-door tests keep testing the door.
- `MISSION.md` says who ARCA's founder is.

## Done by hand, not in this pull request

- **Production's password sign-in for arca.founder@ is removed** by John running
  `~/run/remove-arca-founder-password` on the box. It takes arca.founder@'s entry out of
  `STUDIO_PASSWORD_LOGINS` and keeps any other entry. It takes effect at production's next deploy,
  which is this pull request's.
- **Matthew's address must not be in `STUDIO_ADMIN_EMAILS`.** An admin's sign-off on the Review
  screen counts as John's Approve (`lib/press.ts`), so it would start the merge. The same script
  says whether it is there, without printing the list.

## Left as they were

Old tickets, the status notes and the recorded history (`deploy/activegraph/fixtures/`) keep
arca.founder@, because that is what happened at the time. `CLAUDE.md` and
`docs/fountainbridge-phased-plan.md` use it only as an example of a Bruntsfield address.

A phone Matthew signs up from now is kept under his new address. None was signed up under the old
one.

## Acceptance

- [x] Every unit test passes with the new address; types and lint are clean.
- [ ] After the deploy, Matthew signs in with Google and sees ARCA, and only ARCA.
- [ ] arca.founder@ can no longer sign in with a password on production.
