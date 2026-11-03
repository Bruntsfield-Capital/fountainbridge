# FB-292 — Six deliberate faults the checks must catch

**Status:** Todo · **Kind:** small (about 2 hours) · **Budget:** $2 of factory money for the fault runs · **Phase:** 3 · **Raised by:** John, 3 November 2026 ("fix 6 (deliberate faults)"), to build after the ARCA demo on Monday 9 November 2026, after cowgate CG-0093 · One ticket = one branch = one PR.

## Why

The studio's checks pass on every pull request. Nobody has shown they would fail if something
important broke. A deliberate fault is a small, known break put into a throwaway copy, such as a
founder seeing another venture's card. If the checks stay green with it in, that kind of break can
reach the studio today without anyone noticing.

## What to build

Six faults in `harness/mutations/defects.json`, each aimed at something a founder or John relies on:

- a founder sees another venture's card (venture isolation);
- a founder's Accept merges, or shows "approved", instead of "Signed off, waiting for John";
- a founder's notice is marked sent when it wasn't;
- the desk's "Needs you" stays empty when a card needs the founder;
- the Review screen shows the "before" picture twice;
- on screen: a "Waiting for you" row that stops looking different from a "Done" row.

Then run them and record which check caught each. Any that escape get a check that catches them,
in the same pull request.

## Done when

- [ ] Six faults, each with a sentence saying what it would mean if it escaped.
- [ ] Every one is caught, and the pull request says by which check.
- [ ] `harness/` is protected, so John merges this by hand.
