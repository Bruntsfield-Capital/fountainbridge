# FB-010 — The first outside founder: THE RESET starts fresh on the new system

**Status:** Todo · parked until ARCA runs cleanly on the new setup (John, 2026-10-07) · **Phase:** 3 ·
**Depends on:** FB-264 and the move it recommends; Cowgate's runners (CG-0001 to CG-0004) ·
**Rewritten** 2026-10-07 by the October re-baseline (`docs/status/2026-10-re-baseline.md`) ·
One ticket = one branch = one PR.

## What this was, and why it is rewritten

This ticket was the Phase 1 close-out: a week of running THE RESET and ARCA through the studio, then
a retro. **It never ran, because THE RESET never started.** It has no repository, no machine, and
no founder signed in. Its manifest still says `draft`. Every phase after this one assumed it had
happened.

So the studio has been built for founders, but it has had one user, who is also the person building
it. A real founder using it for a week is the most valuable test it has not had. This ticket is now
that test.

## What John decided (2026-10-07)

- **ARCA is the test bed** for the next few days, while the factory is ironed out on the new setup:
  Archon works the tickets, and Cowgate runs the machines and the spending caps.
- **After that, ARCA's backlog is wiped.** Wiped always means closed with a reason, never deleted,
  so the history survives.
- **THE RESET starts fresh on the new system** after that, not on the old lane.
- **Until then, THE RESET is parked.**
- **There is nothing old to carry over** (John, 2 November 2026). Nothing was ever built for THE
  RESET: it had no repository and no tickets. What it has is its Product Requirements Document and
  a Business Services Requirements document, which define platform v0.1.

## Scope, when John unparks it

1. **Set the venture up on the new system.** Its repositories, Archon registered against them, and
   Cowgate runners for its tickets. Its own persistent machine holds what keeps state (the approval
   record, the brain, the office, the composer), as D11 says. Its manifest moves from `draft` to
   `active` only when all of that works.
2. **Ross signs in** with his Bruntsfield Workspace account. A test must show he sees THE RESET and
   nothing else (non-negotiable 6).
3. **A week of real use.** Ross says what he wants, watches it get picked up, decides when asked, and
   reads what happened, through the studio. Every place he gets stuck, or has to leave the studio, is
   filed as a ticket the same day, however small.
4. **A retro**, written for Ross as much as for us: `docs/retro-first-founder.md`, with the tickets
   it implies.

## Out of scope

- Anything on THE RESET before John unparks it.
- Deleting anything of THE RESET's or ARCA's. Closing with a reason is the only way work is removed.
- Re-running the old lane for THE RESET. It starts on the new system or not at all.

## Acceptance criteria

- [ ] THE RESET runs on the new system, and its manifest says `active`.
- [ ] Ross can sign in, sees only THE RESET, and a cross-venture test proves he cannot read ARCA.
- [ ] Five working days of Ross using the studio, with every friction point filed as a ticket.
- [ ] `docs/retro-first-founder.md` exists, Ross has read it, and its follow-up tickets are filed.

## Verification

Every screen Ross used is rendered at 1440×1000 and 393×851 beside its design and looked at
(non-negotiable 11), on THE RESET's real data rather than ARCA's.
