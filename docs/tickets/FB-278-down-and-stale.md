# FB-278 — When the factory goes quiet

**Status:** Done · **Kind:** small · **Budget:** $15 · **Rough date:** 7 November 2026 · **Pilot step:** 7 · **Raised by:** John, 28 October 2026 (the factory pilot, `docs/prd/factory-pilot-release.md`) · One ticket = one branch = one PR.

## Why

A founder pressing a button on a card the factory can no longer see would think something happened
when nothing did.

## What to do

- The box reports every minute. After five minutes of silence, the cards say "The factory hasn't
  reported since 10:42. These may be out of date.", the buttons switch off, and the page says why.
- A press the box hasn't collected within 10 minutes ends with "Nothing was done."
- **A press the box collected but never answered** also ends with "Nothing was done." 10 minutes
  after it was collected (John, 29 October 2026). The box marks a press collected when it takes it
  (FB-276), so a box that crashes before it answers would otherwise leave the press waiting for ever.
  - "Nothing was done" here is what the card shows, not an answer the studio stores. If the box's
    real answer arrives later (`press-result`), it wins and the card shows it, because the box may
    have acted before it crashed.
  - A press that ended this way no longer blocks a new press on the card, the same as one the box
    answered "out-of-date".
  - Journey 7 in `harness/END-TO-END.md` names only a press "the factory never collected". This
    ticket's pull request adds the collected-but-unanswered case to it, with John's approval
    (`harness/` is protected, so John merges that pull request himself).
- When the box reports again, the buttons come back.

## Done when

- [x] Journey 7 in `harness/END-TO-END.md` passes against a test copy (`e2e/review.spec.ts`, journey 7).
- [x] A press collected and never answered shows "Nothing was done." 10 minutes after it was
      collected, its buttons come back, and a late `press-result` from the box replaces it.
- [x] Every command in `CLAUDE.md` `## Checks` passes.
