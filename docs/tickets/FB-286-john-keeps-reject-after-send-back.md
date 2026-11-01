# FB-286 — After a founder's Send back, John keeps Reject and Try again

**Status:** Done · **Kind:** small · **Budget:** none (built in a Claude session, not by the factory) · **Phase:** 3 · **Raised by:** John, 30 October 2026 ("after a founder's send back, I keep reject and try again in the studio"; cowgate CG-0070), due 5 November 2026 · One ticket = one branch = one PR.

## Why

Once a founder pressed Send back on a factory card, the studio refused every later press on that
card, John's included (FB-276). John wants to decide what happens next himself: Reject the work as
it is, or Try again with the founder's note. The planning box already does this when John taps
those buttons on Telegram, and it accepts them from the studio too (cowgate CG-0070). Only the
studio refused them.

## What changed

- **The rule** (`lib/presses.ts`, `placeFor`): once the box has done a founder's Send back, John's
  Reject or Try again on that card is recorded. It "follows the Send back up". Every other press
  stays out of date: the founder's, and John's Approve, Stop, Split it and Send back. Once John's
  follow-up stands, nothing more is taken on that version of the card. It applies only to a
  founder's Send back, and only once the box has done it. After John's own Send back, nothing
  changes.
- **The store** (`lib/press-store.ts`, both the database's and the browser tests' memory one) uses
  that rule and marks the press `follows_up`.
- **The database** (`db/011_follow_ups.sql`): the new `follows_up` column. A card may now hold one
  standing first press and one standing follow-up. Only John's Reject or Try again can be a
  follow-up. Safe to load twice.
- **The card's state** (`lib/review.ts`): a founder's Send back the box did says John may still
  decide (`johnMay`). While John's follow-up waits for the box, and once the box has done it, the
  card shows it. If the box says it did nothing, or it lapses, the card is sent back again, and says
  what became of it to John only (`lastTry`).
- **The Review screen** (`components/ReviewScreen.tsx`): for John, a card a founder sent back says
  "Sent back · your decision". It shows the founder's note and two buttons: "Try again with the
  note" and "Reject it". On a phone they sit in the bottom bar, as the other decision buttons do.
  The founder sees the card as before, with no buttons.

## What John has to do

Run `db/011_follow_ups.sql` on production (Supabase) before this merges. It adds one column, one
check and rebuilds one index. Until it runs, the studio cannot record any press on a factory card.

## Done when

- [x] After a founder's Send back the box did, John's Reject and Try again each record once; the
  founder's presses and John's others are out of date (tests against the database's own statements,
  and through the studio's press code).
- [x] Not before the box has done the Send back, and not after John's own Send back.
- [x] The database refuses a follow-up that isn't John's Reject or Try again, and a second standing
  follow-up.
- [x] The card shows John's decision while the box does it; one that did nothing or lapsed leaves
  it sent back, saying so to John and never to the founder.
- [x] A browser test: the founder sends back, the stand-in does it, John sees his two buttons and
  the founder none, John's Try again is collected, and the founder's and John's later presses are
  out of date. Looked at, at 1440×1000 and 393×851, as John and as the founder.
- [x] Each rule, taken out, makes a test fail (7 tried).
- [ ] Every command in `CLAUDE.md` `## Checks` passes (on the pull request's checks).
