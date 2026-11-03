# PRD: Foundry Studio, the factory pilot release

**Owner:** John · **Written:** 26 October 2026, revised the same day with John's answers, and published as tickets on 28 October ·
**Design:** new screens come from the "Studios, aligned" Claude Design canvas, in the Bruntsfield
Studios design system. Existing screens follow the prototype named in `CLAUDE.md`, rule 11.

## Goal

The factory can build and check Foundry Studio. Each venture shows its factory work where the
founder already looks, and every finished piece of work gets a Review screen. FB-266 and FB-267
fold into this release. Each closes once its issues are published. Old ticket numbers are in
brackets.

## Done when

- Every journey in `harness/END-TO-END.md` passes against a test copy.
- John has clicked through staging as himself and as `arca.founder@bruntsfield.capital`.
- One real piece of factory work on ARCA has been signed off on its Review screen by ARCA's founder
  account and approved by John. Its card showed the same state in Telegram and in the studio
  throughout.
- Every new or changed screen has been looked at beside its design, at 1440×1000 and 393×851.

## Where factory work shows

**There is no separate factory page.** Cards appear in the views a founder already has:

- **"Needs you":** the desk's list (`components/VentureBoard.tsx`, drawn by
  `app/venture/[id]/page.tsx`), and the Tickets screen's "Needs you" filter
  (`components/TicketsView.tsx`, `lib/tickets-view.ts`).
- **"What happened":** `app/venture/[id]/activity/page.tsx`, drawn by `components/ActivityFeed.tsx`.

A card has one of three states: **finished** (waiting for review), **stuck**, or **sent back**.
The desk's layout doesn't change. D10 is still John's decision.

**The Review screen** opens from a finished card. It has:

- a live preview link, from the pull request's Railway preview environment;
- before and after screenshots, at 1440×1000 and 393×851;
- a plain-English summary, taken from the plan's "What this does";
- feedback placed on a screenshot or on the page, which becomes "Send back with a note";
- Accept and Send back.

The nearest thing today is the work page, `components/WorkDetail.tsx`.

**There is no shared Decision component.** Nothing in `components/` has that name. Accept and Send
back are drawn three times, in `WorkDetail.tsx`, `TicketsView.tsx` and `TicketDrawer.tsx`. Each
calls `acceptWork` and `sendBackWork` and shares only the `noteDecision` helper (`lib/decided.ts`).
Approving a send has its own card, `ApprovalCard.tsx`. FB-273 makes the one shared component.

## Who may press what (settled by John, 26 October)

- **John** sees every card, with Telegram's words and costs. He has Approve and Reject on 🟡
  Needs-you cards, which are new on Telegram too, plus Try again, Split it and Stop.
- **A founder** sees only their venture's cards, in plain English: no dollar figures, no "What to
  do next" lines, no Archon links. They may press Stop, Send back and Accept:
  - **Send back** is the Note. It goes to the box, John sees it on Telegram and in the studio, and
    he passes it on with Reject or Try again.
  - **Accept** is the founder's sign-off, kept in the signed record. The card then says "Signed off
    by <founder>, waiting for John", in the studio and on Telegram. It merges nothing.
- **Only John's Approve merges.** Today's `CLAUDE.md` rule 2, and `acceptWork` in
  `app/actions/work.ts`, let a founder's Accept merge their venture's work. FB-272 changes both.

**What a press does.** The studio checks who pressed and records it. It never calls Archon or
GitHub. The planning box's listener (`factory-alerts listen`) collects the press as it collects a
Telegram tap. It runs the press through the same code: the button's signature, the run still
waiting at the card, then Archon's API. The result shows in both places. The first press wins.

**Isolation is enforced on the server.** Each card is stored with its venture, worked out from its
repository and the manifests' `repos`. Every read and press passes `requireVenture`, backed by the
database's row-level security (FB-170). The parts meant for John are removed on the server, never
sent to a founder's browser. A card that isn't yours gets the same answer as one that doesn't exist.

**Down or stale.** The box reports every minute. After five minutes of silence, buttons switch off
and say why. A press the box hasn't collected in 10 minutes ends with "Nothing was done." A card
answered elsewhere loses its buttons and shows what happened.

## The release, in order

Two tracks run side by side: the studio's tickets (FB) one at a time, each from `main` after the
last has merged, and cowgate's (CG) one at a time on their own. No pull request sits on another.
Dates are rough. They assume John reviews each pull request within a day.

**The studio (fountainbridge)**

| Step | Ticket | What | Size | Budget | Rough date |
|---|---|---|---|---|---|
| 0 | FB-271 | Both must approve means both: `canApprove` let either person alone grant a "dual" item (a send, a payment, a secret). A live gap in production, and every later step adds approvals on top of it. Built by Claude directly. | small | $15 | 28 Oct |
| 1 | FB-272 | Ready for the factory: a test copy with a throwaway database per run, `/build-id`, `harness/runtime.inputs.json`, `CLAUDE.md` and rule 2, staging's own database and ARCA's founder sign-in. Built by Claude directly, because the factory can't build the studio before it. | medium | $25 | 30 Oct |
| 2 | FB-273 | One Decision component, from the three copies. | small | $15 | 31 Oct |
| 3 | FB-274 | The Review screen, from the "Studios, aligned" canvas (its design is ready, John, 28 October). Reads the fixtures until step 4. | medium | $25 | 3 Nov |
| 3a | FB-281 | Sending work back no longer says "accepted". Since FB-273 it is one line in `components/Decision.tsx` (John, 28 October). | small | $10 | 3 Nov |
| 4 | FB-275 | The door and the card store, by venture. | medium | $25 | 4 Nov |
| 5 | FB-276 | Presses, checked on the server. | medium | $25 | 5 Nov |
| 6 | FB-277 | Cards in "Needs you" and "What happened" [replaces FB-266]. | medium | $25 | 6 Nov |
| 7 | FB-278 | Down and stale. | small | $15 | 7 Nov |
| 8 | FB-279 | Founders get a message on their phone (John, 28 October). John chooses the channel first. | medium | $25 | 9 Nov |
| 9 | FB-280 | The demo on ARCA. | medium | $25 | 9 Nov |

**The factory (cowgate)**

| Ticket | What | Size | Budget | Rough date |
|---|---|---|---|---|
| CG-0063 | Every Telegram message becomes a card. Founder-safe parts are marked. (The new factory's runs already send Telegram cards: CG-0056.) | medium | $25 | 29 Oct |
| CG-0064 | Approve and Reject on Telegram's Needs-you cards, for John only [replaces FB-267]. A test proves an Approve grants nothing external. | medium | $25 | 30 Oct |
| CG-0067 | Foundry and ARCA on the factory: budgets, and `factory-main-watch` for both (ARCA's default branch is `master`). | small | $10 | 30 Oct |
| CG-0065 | Screenshots: when a pull request's preview is up, the box takes before and after pictures at both sizes, and sends them with the card. | medium | $25 | 2 Nov |
| CG-0066 | The listener's second inbox: it collects studio presses as it collects Telegram taps. | medium | $25 | 3 Nov |

All sixteen add up to $340. **Demo-ready: Monday 9 November** (John, 2 November 2026). The dates move if a review takes
longer than a day. (ARCA's and Foundry's pull request previews work: FB-230, closed 28 October.)

Journeys: 1 and 2 by step 1; 4 and 5 by step 3; 3 by step 6; 7 by step 7. Journey 6 grows with
steps 4, 5, 6 and 3.

## Rules every issue keeps

- **Isolation is on the server,** with a test that tries to cross and fails.
- **One path for every press:** the box's listener.
- **No screen before its design.** The desk's layout doesn't change.
- **Nothing private in this public repository.** Screenshots of a venture live in the studio's
  database, never in git.

## Settled by John

- **ARCA's demo cards and screenshots count as test data on staging** (26 October). Staging's
  database still never holds any other real founder data. ARCA's founder account is John's own,
  and no other venture is connected to staging.

## Not in this release

- A new desk (D10).
- Retiring ARCA's lane for good [FB-268], and the machines handover [FB-269].
- THE RESET's start [FB-010].
- Decision times, a way out for old decisions, and speed work [FB-159, FB-265, FB-164].
