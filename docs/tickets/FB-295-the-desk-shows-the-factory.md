# FB-295 — A venture the factory builds shows the factory, not its old machine

**Status:** Done · **Size:** medium · **Budget:** none (built by Claude by hand) · **Rough date:** Wednesday 4 November 2026, before the ARCA demo on Monday 9 November · **Asked by:** John, 3 November 2026 ("the red 'not checked in' warning first") · **Repo:** fountainbridge · One ticket = one branch = one PR.

## Why

ARCA moved to the factory (FB-264, FB-272), and its old machine stopped. The studio still read that
machine, so ARCA's screens said things that were true about the old machine and wrong about ARCA:

- a red line: "Your team has not checked in for 26 days … something is wrong with this venture's
  machine";
- the office, a drawing of people at desks on the old machine;
- "What your team did", the old machine's runs from weeks ago;
- on the side menu, the same check-in line, and budgets that said "checking" and never finished.

## What changes

For a venture the factory builds (`lib/factory-built.ts`, ARCA only today):

- The studio does not read the old machine at all, on the desk, the side menu or the Tickets page.
- **The desk:** the office and "What your team did" are replaced by one section, "The factory", with
  one line: "The factory builds ARCA. Last added: [title], [time]." When nothing has been added yet,
  it says so. When the factory hasn't reported, it says what the cards already say: "The factory
  hasn't reported since [time]. These may be out of date."
- **The side menu:** the same line in place of the check-in line. No budgets: they were the old
  machine's, and the factory's money is set per piece of work on the planning box.
- **The Tickets page:** no "has not checked in" sentence on any row.
- The factory sends a card when a pull request opens, not when a build starts. So the line never
  says whether something is being built right now.

A venture with its own machine is unchanged.

## How the list is kept

The venture's manifest follows the bcap-contracts `Venture` schema, pinned at 0.1.0, which has no
field for this, so the list is in `lib/factory-built.ts`. Production sets nothing and gets that
list. `STUDIO_FACTORY_BUILT` replaces it. The browser tests set it empty, because their ARCA fixtures
are an old machine's records and most suites test those screens. `npm run test:e2e:factory` runs
`e2e/factory-built.spec.ts` with it set to `arca`. CI doesn't run that suite yet: adding it is a
one-line change to `.github/workflows/ci.yml`, which is John's to make.

## Acceptance

- [x] ARCA's desk shows "The factory" and its one line, and no office, no runs, no "checked in"
  (`e2e/factory-built.spec.ts`; pictures at 1440×1000 and 393×851: the desk is 1,484 pixels tall
  on a computer, down from 2,206).
- [x] The side menu shows the same line and no budgets.
- [x] The Tickets page never says the old machine has not checked in.
- [x] A venture with its own machine is unchanged, and every existing browser test passes with the
  setting off.
- [x] `lib/__tests__/factory-built.test.ts` covers the line's four cases and the setting.
