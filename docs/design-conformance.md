# The studio, measured against its design

**Taken 2026-09-02**, against `main` at `64f3eaa`, on production
(`foundry-studio-production-4a73.up.railway.app`) signed in as ARCA's founder.

Both sides were rendered in a real browser and looked at — the design prototype was clicked through
screen by screen, not read as markup. This is the scorecard CLAUDE.md rule 11 asks every screen
change to add a line to.

## How to take it again

**The short way, added 2026-09-30:**

    export GITHUB_TOKEN="$(gh auth token)"
    export E2E_TEST_LOGIN=1 E2E_TEST_LOGIN_SECRET=pick-anything-local
    export AUTH_SECRET=pick-anything-local AUTH_TRUST_HOST=true
    export STUDIO_ADMIN_EMAILS=john.gallagher@wealthcx.com
    npm run build && npm run start -- --port 3200 &
    node scripts/measure-on-real-data.mjs

That reads the venture's **real** data. Git is the source of truth for work items, so a local build
with a real token reads exactly what production reads; the deployment adds a hostname, not a fact.
Sign in as the **founder**, not an admin — an admin sees wiring warnings a founder never does, worth
136px on the desk. Both `E2E_TEST_LOGIN` variables are required: with only the first, sign-in fails
silently and every height you record is of the sign-in page.

For each route the script records `document.documentElement.scrollHeight` and
`scrollWidth - clientWidth` at **1440×1000** and **393×851**, and says where it landed, so a reading
taken on the wrong page announces itself. Then open the design artifact in a browser, click through
to the matching screen, and *look at both.*

Height is not the point — it is the cheapest visible proxy for "this screen shows more than it was
designed to". Every gap below was found by the number and then confirmed by reading the picture.

## The scorecard

| screen | design | desktop | phone | verdict |
| --- | --- | --- | --- | --- |
| Sign in | one screen | **1,000px** | **851px** | **compared, FB-189** — matched on height, wrong on everything else |
| The desk | ~1,900px | **1,689px** | **2,175px** | **re-measured 2026-09-30 on real data as the founder — under the design.** rows not cards (FB-183), one block (FB-186), full width (FB-188), FB-203 items 1–13, bounded FB-178 |
| Tickets | 1,090px | **1,325px** | **1,600px** | fixed FB-185, widened FB-188, FB-208 (was 6,864 / 8,008) |
| a ticket | — | **1,202px** | **1,945px** | fixed FB-185, widened FB-188 (was 6,864 / 8,859) |
| What happened | ~1,000px | **1,236px** | **2,547px** | **re-measured 2026-10-02 on real data as the founder, beside the design.** one line per stretch of work (FB-180 finish); fixed FB-180, widened FB-188 (was 3,556 / 6,536) |
| Memory | ~1,000px | **1,096px** | **1,988px** | fixed FB-181, widened FB-188 (was 1,570 / 2,881) |
| Composer | ~1,000px | **1,096px** | 1,142px | **matches** |
| Handbook | 1,000px | **1,096px** | **1,581px** | **explained and fixed, FB-190** — see below |
| a chapter | ~1,000px | **3,318–16,198px** | — | **the 1,188px reading was wrong** — see below |
| The pocket studio | ~600px | — | **2,228px** | **fixed, FB-160** (was 4,221px), FB-203 items 1–13 — the desk's phone row IS this screen |
| Monthly budgets (FB-239, Bruntsfield only) | none — the design has no such screen | **1,000px** | **994px** | **drawn 2026-10-02 by the CI UI gate from fixture rows (two ventures), looked at; not compared** — the design artifact has no budget screen, and port 3312 was held by another session, so it was not drawn locally or on real data. No sideways scroll. |

No screen scrolls sideways at either size. That was not true two weeks ago (FB-153, FB-124).

## What the numbers turned out to mean

**The desk's gap was not the approval cards.** FB-183 turned them into rows, which is right and is
what the design asks for — and the desk barely moved: 3,217px to 3,185px. On ARCA that is one card
removed, while the design's own row shape adds a line of meta to all ten waiting rows. The two
roughly cancel.

Reading the screen rather than the number found the real cause: the venture's three surfaces are
stated **twice**, as a 505px block of cards and then again as a list underneath it, with the same
counts in different words. Filed as FB-186. This is the clearest case yet of the thing this
scorecard says about itself — height found a screen showing too much, and only the picture said
what.

**Tickets was the worst screen, at six to eight times its design. FB-185 fixed it** — 6,864px to
1,471px on desktop, 8,008px to 1,470px on a phone.

The ticket predicted one cause and there were two.

The predicted one was right and was the larger: the screen opened on **All**, which is every ticket
the venture ever had — 80 on ARCA, 37 of them finished — against a design that opens on **Needs you**
(`filter: 'needs'` in the wireframe's own state, twice). That is one line, and it took desktop from
7,123px to 2,967px.

The second was not in the ticket. The detail pane **rendered the whole ticket file**, at the global
heading sizes, in a column beside the list: `Context`, `Scope`, `Out of scope`, `Acceptance
criteria`, research bullets carrying full URLs. ARCA-068 is 1,730px of that on its own, sitting
directly above the box where a founder approves the work. The design's ticket detail is the opening
of the ticket and then the decision — it shows no scope list anywhere. So the opening is shown and
the rest is one press away behind **Read the whole ticket**, and nothing is removed.

A third thing the height could not have found, and the picture did: on a phone the two columns
stacked, so the screen showed the whole queue *and* the full text of whichever ticket it had selected
by default underneath it. Opening a ticket then meant scrolling past all eighty to reach it. The
design's phone treatment is one column at a time, and it is now one column at a time.

**How the after numbers were taken.** The before numbers are production. The after numbers are a
local production build running on production's own configuration and reading the same live GitHub
data — ARCA's real 80 tickets — because the change is not deployed until it merges. Same data, same
build, different host. Re-confirm on production once it has deployed.

**The pocket studio shows two sections the design does not have on a phone.** The design's own
description is exact: *"The same events, one column: the blocker banner, the live office, the queue,
the prompt."* Four things, about 600px. Ours has those four (85 + 568 + 668 + 112 = 1,433px, already
more than twice the design's) and then adds `lane-activity` (305px) and `dept-surfaces` (1,031px),
neither of which the design puts on a phone at all.

**Three screens match and should be left alone**: the Composer, a Handbook chapter, and the Handbook
on desktop. The Composer matching matters — it is the screen with the most behaviour on it.

**"What happened" was a commit log and is now an account. FB-180** took it from 3,556px to 1,487px
on desktop and 6,536px to 2,910px on a phone, and the height was the smallest part of it. All six
faults the audit named are gone: twenty identical rows are one row with a count, slugs read as
`ARCA-061, saved card lists not persisting`, commit prefixes and pull request numbers are stripped,
a push and its pull request are one row, dates are `Today 00:57 / Yesterday / 27 August` with the
calendar date still on the row for anyone who needs it, and the meta column names `Build — Product`
rather than `arca`.

Two things came out of reading it that the ticket had not named. The meta column was saying the
meaning as well as the surface — `Build — Product · shipped` — which the sentence beside it already
said, and the width that cost wrapped eleven of twenty rows onto a second line. And the summary's
`Most recently: A, B and C` names the three items that are the first three rows directly beneath it.

**Sign in matched its design exactly on height and was wrong about almost everything else.** One
screen, no scroll, 1,000px and 851px on both sides — identical numbers, before and after FB-189
changed the wordmark, the heading size, the fields, the second button, the divider and the footer.

That is the sharpest thing this scorecard can say about itself. A number that agrees with the design
is not evidence the screen does. This one was never compared because it fits on a screen, and fitting
on a screen was never the question.

What was wrong: the wordmark was `Bruntsfield` at 21.6px with no rule, against the design's 24px
`BRUNTSFIELD` over a hairline; the heading was 56px against 32px, so the page shouted the verb and
whispered whose studio it is; the fields were boxes where the design draws underlines. The product
also carried **two wordmarks** — the rail in caps, the top bar and this page in mixed case. It
carries one now.

**The pocket studio carries the four things the design names, and the rest is one press away.**
FB-160 took it from 4,221px to 2,745px at 390×844. What came off is what the design does not put on
a phone: the surfaces block, what the team has been doing, the desk summary and two header lines.
What stayed is everything a founder can act on — including "Where things stand", which names the
ticket that is stuck, and which appears nowhere else on that screen.

Two faults there that the height had not shown. The venture's **name** was rendering after the
prompt bar, because everything the pocket order does not name falls to `order: 5`. And the queue rows
put the title and `waiting 34 days Decide →` side by side in a 345px column, so every title wrapped
to three lines.

**Every screen with a rail was drawing a 1,080px design into a 766px column. FB-188 gave it the
width back.** The rail sits inside the element the 68rem measure was set on, so 68rem was the rail
plus the content and the content got 766px — 29% under the figure the stylesheet's own comment says
it is aiming at. The measure now covers the rail, the column is 1,078px against the design's 1,080px,
and five screens came down at once with no content removed from any of them:

| | before | after |
| --- | --- | --- |
| The desk | 2,603px | **2,395px** |
| Tickets | 1,471px | **1,202px** |
| a ticket | 1,508px | **1,202px** |
| What happened | 1,487px | **1,264px** |
| Memory | 1,134px | **1,096px** |

That is the desk under the 2,500px target FB-186 could not reach, and it was never about the desk's
content.

**Two things the sweep found that the audit had not.**

*Every handbook chapter scrolled sideways on a phone.* FB-153 found that `.ticket-body` was a class
name with no rule behind it, so a long URL pushed the page sideways; it fixed that class and did not
look at `.playbook-prose`, which was the identical case. Chapter one carries an ASCII diagram 644px
wide in a 393px window, and the page moved with it. The same four rules are on both classes now.

*This scorecard's "a chapter — 1,188px — matches" was wrong.* Every real chapter is thousands of
pixels: 3,318px for the shortest and 16,198px for the longest. Nothing measured 1,188px. A chapter is
long-form reading and its length is not a fault — but the line said the studio matched its design on
a screen nobody had actually measured.

**The desk stated its surfaces twice, and FB-186 made it once.** 2,912px to 2,603px. The second
block repeated the three names, the three repositories and the three ticket counts already on the
cards above, in different words, and every figure in both was correct — which is why nothing caught
it and only looking did. Each card was also saying its own ticket count twice, once in its outcome
sentence and again beside the door.

**And the rest of the desk's height is not duplication at all.** The content column beside the rail
is **766px**; the design's is **1,080px**. Ours is 29% narrower, so every sentence wraps sooner and
every block is taller — on every screen with a rail, not just this one. The stylesheet says it meant
to give the content about 1,080px, and the measure it uses includes the rail, so it does not. Filed
as FB-188, because one line there moves every screen and each one needs looking at again.

That is worth stating on a scorecard about heights: **several of these numbers are partly a column
width, not the content on the screen.**

**Memory was listing scaffolding as knowledge. FB-181** took it from eleven rows to five, and the
five are the five a founder actually handed over or their team learned. Six of the eleven were
`context/README.md` and `library/README.md` — the files committed when the corpus directories were
created, one per repository — on a screen whose own sentence is *"Everything you have handed over or
your team has learned"*. `wealthcx01` no longer appears in a column headed **From**, and every row
names its surface.

The screen's own summary told the truth about this the moment the readmes went: *"11 documents — 8
pieces of background, 3 artifacts"* became *"5 documents — 5 pieces of background"*. **All three
"artifacts" were readmes.** ARCA's `library/` holds nothing yet, and the screen had been saying
otherwise.

One thing worth recording, because only looking found it: the first fix keyed each row's surface off
its **repository**, which relabelled `context/sell/brand-positioning.md` as *"Build — Product"* —
it is a Sell document kept in the product repo. That replaced something true with something false,
on the screen whose whole complaint was rows that mislead. The document's own path wins now, and a
test pins it.

**The Handbook's "phone unexplained" was three wrong things in one line, and FB-190 unpicked them.**

It is not a page of prose. It is nine chapter cards in a 3×3, and three across becomes one across on
a phone — nine stacked cards are *expected* to be taller. Growing 62% is less than the change in
columns would suggest, not more.

The desktop number is not the content. The cards end around 660px; the page measures 1,096px because
the rail sets the floor. The comparison was a card grid against an empty space.

And the phone had nothing to compare against. The design bundle is a fixed-width prototype — at 393px
it still draws the 250px rail and the three-column grid, crushed. Its "phone" reading is the desktop
layout squeezed, not a phone design. **The design has no phone handbook.**

There was no phone defect. What there was, at both sizes, is that the design draws the chapter index
as **one block with hairline rules between the cells** and ours drew nine separately bordered cards
with gaps. That is fixed, and the phone came down to 1,581px — eight gaps and eighteen borders the
design does not spend.

**Sign in was never compared.** It is the one screen a founder sees before they trust anything, and
it is not in this table because I did not do it.

## FB-203, items 1–6: the top half of the desk

Read on **2026-09-08** at 1440×1000 and 393×851, twice: first on the fixture server while the work
was in progress, then on production once it had merged and deployed, signed in as ARCA's founder
against its real 73 tickets.

| | desktop | phone |
| --- | --- | --- |
| The desk, on fixtures, before merge | 3,050px | 3,449px |
| **The desk, on production, after merge** | **2,370px** | **2,753px** |
| The desk, on production, before this | 2,395px | 2,745px |

Sideways scroll: **0px, at both sizes, on both.**

The desktop came down 25px and the phone went up 8px, which is the honest answer: **items 2 to 6
were not about length.** They removed a heading, a pill, a sentence, a box and three links, and
added a description, a second banner row and the drawn empty state. What changed is what a founder
reads first — the venture's purpose and the two things waiting, rather than their own venture's
name. The desk is still 470px longer than the design's ~1,900, and items 7 to 13 are where that
closes.

The fixture numbers are in the table because they are what the work was checked against, and they
are **not comparable** to the production ones — fixtures carry three tickets, production carries
seventy-three.

**Looking found two faults that every gate had passed.**

The first is the one this rule keeps catching. On the phone, the blocker banner kept "Decide now →"
in its place at the right of the row, which left the sentence a column about fifteen characters
wide, and one banner ran **twelve lines down a 393px screen**. Lint, types, 1,596 unit tests and 284
browser tests were green: the banner was present, correct, linked, and in the right place. It was
also unreadable. The action now drops beneath the sentence below 30rem, and `pocket.spec.ts` asserts
the sentence gets more than 60% of the box — a proportion rather than a pixel count, so it keeps
holding as the copy changes.

The second only appeared because the first was wrong. The fix gave the sentence a full-width flex
basis, which pushed the **square marker onto a line of its own** — a small block floating above a
paragraph, reading as decoration rather than as a mark against the text. `flex-basis: 0` on the
sentence keeps the two together. Neither of these is a thing a test would have been written for.

A third fault was found by re-reading the ticket against the picture rather than by looking alone.
The stuck line was drawn in the studio's blocked tone, which is red — and item 5's complaint about
the box that line came from is precisely that *"its bold red underlined links are the loudest thing
on the page"*, followed by *"the design has no red at all."* The row is amber now, the same as the
banner above it; the two differ in what they say and where they go, not in colour.

One picture also lied, and it is worth writing down. The phone screenshot came back with the banner
in a green tint instead of its warm ground, because the login click had left the virtual pointer
resting on the banner and the screenshot caught its `:hover` state. Chasing it turned up something
real anyway: on a touch screen there is no un-hover, so a tapped banner would have kept that tint
after the founder came back from the queue and read as still selected. The hover is now behind
`@media (hover: hover)`, and the screenshot script parks the pointer before it fires.

## FB-203, items 7–9: the office, its ledger, and the run history

Read on **2026-09-08** at 1440×1000 and 393×851, on fixtures — the production reading follows when
this merges and deploys, as it did for items 2–6.

| | desktop | phone |
| --- | --- | --- |
| The desk, on fixtures, after items 2–6 | 3,050px | 3,449px |
| **The desk, on fixtures, after items 7–9** | **2,855px** | **3,193px** |

Sideways scroll: **0px at both sizes**, and 0px on the phone in `?full=1` as well, which is where the
run history is shown.

**Looking found three things.**

The first was a sentence that was not true. The design puts "LIVE FROM ARCA’S MACHINE" beside the
section heading, and built there it printed *"Live from your venture’s own machine"* directly above
the **stand-in drawing** — whose own note, two lines below, says *"This is a stand-in."* The label was
driven by `office.live`, which means the box is sending run reports; whether the real room is on the
screen is a different question, and only `OfficeEmbed` knows it. The label moved there. A label that
can be wrong about the thing beneath it is worse than no label at all.

The second: `48 days ago` wrapped onto two lines in the design’s 76px time column, leaving every run
with a ragged stub in its first column. The design’s example runs were hours old; ARCA’s fixtures are
seven weeks old and its production runs are older still. 92px.

The third: the outcome square was vertically centred in its row, so on any run whose sentence wrapped
it drifted down and ended up marking the second line. It sits on the first line’s baseline now.

**And one fault that a picture could not have found, only reading the code.** The ledger lived inside
`OfficePlate`, which is the **fallback** — the drawing shown when the real office cannot be. So on
every venture whose embed worked, the ledger was not rendered at all, and the half of this pairing a
screen-reader user gets was the half that vanished exactly when the venture was healthiest. Nothing
on the screen said so, because on fixtures the embed never loads and the plate always renders. It is
its own component now, outside the fallback, and a test asserts it is not a descendant of it.

## FB-203, items 7–9 on production, and the fault only production had

Read on **2026-09-08** at 1440×1000 and 393×851, signed in as ARCA's founder.

| | desktop | phone |
| --- | --- | --- |
| The desk, after items 2–6 | 2,370px | 2,753px |
| The desk, after items 7–9 | 2,434px | 2,562px |
| **The desk, after both corrections below** | **2,457px** | **2,562px** |

No sideways scroll at any of those readings. The phone came down 191px and the desktop went up 87px.
That is the honest shape of this work: the room and the ledger now share a row, so the section is as
tall as the room rather than as tall as both, and on the phone the run history stands down entirely —
while the desktop paid for a section heading, a rule, and two sentences that were not there before.
The desk is still about 550px longer than the design's ~1,900. Items 10 to 13 are where that closes.

**The live label was checked in both directions and is right in both.** On the desktop the real room
renders, the stand-in is absent, and the label is shown. On the phone the embed stands down by design
(FB-163 — pixel-agents draws its room at a fixed scale and a phone would show a corner of a floor), so
the stand-in renders and the label is correctly **not** shown.

**And then the number that fixtures could never have produced:**

> Showing the 1 most recent of 3459 runs.

One row. ARCA has 3,459 run reports and every one of them is the same park, so `collapseRepeats`
merged the whole history into a single line. Item 8 asked for the `×20` repeat tag to go, it went, and
with it went the only thing on the screen saying this venture had been stuck in one place for seven
weeks — which is the most important fact this section could carry. The tag stays gone and the fact is
in the row now, in words: *"the same thing 3,459 times"*.

This is the clearest case yet for the rule that says **production, not fixtures**. The fixtures have
six runs, all different. Every gate was green. The screen was rebuilt, looked at, measured, and
shipped, and the defect was in the one place a small dataset cannot reach.

**The correction needed correcting, and again only production showed it.** The new clause read *"the
same thing 20 times"* above *"1 most recent of 3,461 runs"*, because the studio reads twenty reports
and counts the rest by name — the count can never exceed twenty however long a venture has been stuck.
It now says *"every one of the last 20 runs says this"*, which is what the studio actually knows. The
logic moved into `lib/runreports.ts` so the branch has unit tests, because a venture with 3,461 runs
cannot be built as a browser fixture — the same reason the fault reached production in the first
place.

The same reading turned up **FB-205**: the most-repeated sentence in ARCA's history renders as *"Daily
your team budget reached"*, because FB-103's `lane → your team` rule cannot tell a lane that acted
from a lane describing a budget.

## FB-203, items 10–13: the queue, the surfaces, the rail and the type

Read on **2026-09-08** at 1440×1000 and 393×851 on fixtures; the production reading follows the
merge, as it did for the earlier items.

| | desktop | phone |
| --- | --- | --- |
| The desk, after items 7–9 | 2,855px | 3,193px |
| **The desk, after items 10–13** | **2,220px** | **2,611px** |

No sideways scroll at either size, nor on the phone in `?full=1`. Tickets reads 1,167px and the
Handbook 1,000px with the lighter headings.

**The cap nearly hid a whole kind of decision.** Capping "Waiting on you" at four rows is the design's
instruction, and the queue is ordered by kind — external sends first, because nothing leaves the
company without one (FB-183). ARCA has six sends. So the cap showed four sends and **every piece of
finished work fell off the desk**, including the pull requests the amber banner had just counted, on
the screen that banner sends a founder to. The browser gate caught it; a founder would have caught it
by wondering where their work went. `deskQueue` reserves the last row for whichever kind the cap would
otherwise erase.

**And the phone read as two layouts.** A long reference like `changed-proposal` took the full width
and pushed its title down, while `ARCA-1` sat beside its own — so the same list looked different
depending on how a ticket happened to be named. The reference takes its own line always.

**Item 13 found two real deviations after every colour already matched.** Headings were `font-weight:
500` against the design's 400 — a serif carries its weight in its own shapes, and half a step extra
reads as a slightly wrong font rather than as emphasis. And three rounded corners had survived: two
50% dots and a textarea. The design has no border-radius anywhere.

**Two parts of item 12 are not built, and the scorecard should say so rather than imply the screen
matches.** The rail has no pocket-studio link, because the pocket studio is not a route — it is what
the desk becomes on a phone, and the rail is hidden there, so the link could only ever be pressed
where it does nothing. And the rail has no office thumbnail: half its sentence duplicates the Needs
you badge three rows above, and the other half needs a run report per surface, which is the read
FB-164 removed when it was costing every screen under a venture about six seconds.

## FB-203, closed — the desk on production, 2026-09-08

All thirteen items merged and deployed. Read as ARCA's founder against its real 73 tickets and 3,461
run reports, at 1440×1000 and 393×851.

| | design | desktop | phone |
| --- | --- | --- | --- |
| Before FB-203 | ~1,900px | 2,395px | 2,745px |
| **After FB-203** | ~1,900px | **1,984px** | **2,228px** |

**84px from the design, with no sideways scroll at either size.** The screen this scorecard opened on
was **9,908px**.

What the thirteen items actually cost, in the order they were worked:

| after items | desktop | phone |
| --- | --- | --- |
| 1 (the shell) | 2,395px | 2,745px |
| 2–6 (the top half) | 2,370px | 2,753px |
| 7–9 (the office and the record) | 2,434px | 2,753px |
| 10–13 (the queue, surfaces, rail, type) | **1,984px** | **2,228px** |

The middle two rows are the honest part of that table: items 2 to 9 barely moved the number, because
they were not about length. They changed what a founder reads first and put three sections in the
shape the design draws. The height came out of items 10 and 11 — a capped queue and three columns
where there had been bordered cards.

**Six faults reached this screen that every automated gate passed**, and each was found a different
way. Four by looking: a banner twelve lines tall on a phone; a marker floating above a paragraph; a
"live from your machine" label printed over a stand-in drawing; a queue that read as two layouts
depending on how a ticket was named. One by reading code: the ledger living inside the fallback, so it
vanished on every venture whose office actually worked. And one only production could show: 3,461 runs
collapsed to a single row, twice — once when the count disappeared, and again when the corrected count
said 20 above a footer saying 3,461.

The fixtures have six runs, all different. That is the whole argument for rule 11's "measure
production" in one line.

## The second review — Claude Design, 2026-09-08

Read against `main` after FB-203 closed, from the code and the docs rather than from the live route
(which sits behind sign-in). The artifact:
`https://claude.ai/code/artifact/a9532879-0dbf-4273-9893-8c79cd74e202`.

**Its verdict: *"the desk is the design. Four of the five rules hold. One does not, and the screens
FB-203 did not touch carry the rest."***

| rule | verdict |
| --- | --- |
| 1 · Decided → What happened only | **Not held** — the desk still renders two ApprovalCard sections |
| 2 · Waiting items are rows | Held — two leaks: Memory's routines, and those same two sections |
| 3 · Outcomes, not counts | Held — *"Nothing invented."* |
| 4 · Office is the pixel-agents embed | Held — *"Better than the design asked."* |
| 5 · Every ticket has a terminal trace | **Partly** — the "Follow it to…" line above the decision is not rendered |

**All four of FB-203's deviations were accepted**, including the two parts of item 12 that were not
built (*"a control that works nowhere it is shown is a dead control"*), the vocabulary changes
(*"Binding"*), and the stale clause. The wireframe was updated to match our vocabulary rather than the
other way round.

Twelve findings, filed as seven tickets in the reviewer's own order:

| | ticket | what |
| --- | --- | --- |
| R-01 + R-11 | **FB-207** | decided work leaves the desk, once What happened can prove it was signed |
| R-06–R-08 | **FB-208** | the tickets screen against its design |
| R-05 | **FB-209** | the conversation on a ticket has nowhere to be read |
| R-02 | **FB-210** | squares, not glyphs, everywhere |
| R-03 | **FB-211** | amber for a decision, red only for a fault nobody can clear |
| R-09 | **FB-212** | Memory's routines are still cards |
| R-10 | **FB-213** | a surface's "open the queue" opens everybody's queue |
| R-04 | FB-184 | already open; restated with the exact copy and placement |

The order is the reviewer's: *"R-01 with R-11 first (they unblock each other), then Tickets
(R-04–R-08), then R-02 across every screen, then Memory."*

**R-01 and R-11 are one ticket for a reason the code already knew.** The desk's own comment, written
when the first instruction to move those sections arrived, says they stayed because *"it is the only
place a founder can see whether a COMPLETED approval's signature was genuine"* — and the reviewer's
R-11 says the same thing from the other side: *"This is what kept R-01 on the desk."* Giving What
happened the attestation is what unblocks the deletion.

## FB-207, and a screen production cannot yet show

Read on **2026-09-08**, after merge and deploy. **The change is not observable on production, and
that is the finding rather than a caveat.**

ARCA has **no decided approvals at all**. Every external action on it is still `proposed` — waiting in
the queue for a founder's yes — so What happened has **zero decision rows**, and there is nothing for
the attestation clause to attach to. The desk's two `ApprovalCard` sections were never rendering
there either, for the same reason: they only appear once something has been granted.

So the section that was defended twice, on the grounds that it was the only place a forged grant would
be visible, has never had anything in it on the live studio. The defence was still right — the first
approval ARCA grants would have put a completed decision on that desk and nowhere else — but it is
worth writing down that the fault it guarded against was latent, not live.

Where it *is* proven: the fixture rig, which now carries `executed-forgery` — a grant the studio did
not issue, which the executor acted on. That case had **no fixture before FB-207**, because the two
existing adversarial grants have no execution record and are therefore `proposed`, which is a queue
item and not history. It is the row pinned to the top of What happened on the rig, in amber, saying
its signature did not verify.

| | desktop | phone |
| --- | --- | --- |
| The desk, on production | **1,984px** | — |
| What happened, on production | **1,218px** | — |

Unchanged from the FB-203 reading, which is the expected result of deleting two sections that were
not rendering.

## FB-208 — the tickets screen, 2026-09-09

Read at 1440×1000 and 393×851. On fixtures **1,137px** and **1,059px**; on production, against
ARCA's 80 real tickets, **1,325px** and **1,600px**. No sideways scroll at any of them. The design is
1,090px.

The 235px between the fixture reading and production is almost entirely **title wrap**: ARCA's tickets
are named things like *"Research: which auction houses we can realistically pull live listings from"*,
which takes four lines in a list pane about 450px wide. The design's list had short titles. Nothing is
repeated and nothing is decorative — the screen is as tall as the sentences a founder actually wrote,
which is the right thing for it to be as tall as.

Tabs are text on a hairline now rather than four buttons — which had made the four most button-shaped
objects on the screen the ones that only narrow a list, beside a detail pane whose buttons merge
finished work into a founder's product. The row is title, then `ref · surface`, with the wait pushed
right in amber; status left the row because status is what the filter already selects, and progress
moved into the detail's eyebrow.

**"Proven" said the same thing about every ticket whether or not it was true.** It now reads
`ciStatus` — the same field the work page reads, so the two screens cannot tell a founder different
things about one piece of work — and it tells two silences apart: *"the studio could not read this
venture's checks"* is not *"no checks are recorded against this work"*, and neither is *"they passed"*.

**One part of R-08 cannot be built yet, and it is worth saying why.** It asks for *"Unchanged since you
last read it"*. The studio does not remember when a founder last read anything: `headSha` is the commit
at page render, and `acceptWork` compares it at accept time to refuse work that moved underneath a
decision. Comparing it to itself on render would always say "unchanged". A per-founder read record is a
store the studio does not have, and inventing the sentence without it would be the same fault the
ticket is about.

## What this scorecard cannot tell you

Height finds a screen showing too much. It cannot find a screen showing the *wrong* thing at the
right length, wrong copy, wrong order, or a control that does not work. Every one of those has been
found here by reading the picture, and three of them — the desk's finished-ticket board, "What
happened" printing one sentence twenty times, and Memory listing README files as founder knowledge —
passed every automated gate in the repository.

## The desk over a real backlog — FB-178, 2026-09-30

**These are fixture readings, not production readings.** They are kept separate from the scorecard
above for that reason: every number in that table was taken on the production server signed in as
ARCA's founder, and these were not. Production still needs a signed-in session the lane does not
have — checked on 2026-09-30, and an unauthenticated request lands on `/login`.

| the desk, at 1440×1000 | backlog | height |
| --- | --- | --- |
| the gate's committed fixture | 6 tickets, 6 run reports | **2,165px** |
| a fixture at ARCA's real size | 73 tickets, 1,773 run reports | **2,230px** |
| the same, at 393×851 | 73 tickets, 1,773 run reports | **2,721px** |

**Sixty-five pixels separate a venture's first week from its 1,773rd run report.** That is the
reading worth having, and it is not a height — it is the difference between two heights. The desk's
design target is ~1,900px, and a single number against it says whether the desk is short enough
today; only the difference says whether it will still be short enough in a year, which is the fault
FB-178 was actually raised for.

### Why this reading needed a new fixture

The committed fixture holds six tickets. Every list on the desk is capped — the waiting queue at
four rows, the engine list at four runs, the brief at one sentence per kind. **A cap of four over six
items renders exactly the same screen as no cap at all over six items.** So the fixture the desk's
height had been measured against all along could not distinguish a bounded desk from the 9,908px one.

`scripts/make-scale-fixture.mjs` builds the venture at ARCA's numbers and
`e2e/desk-at-scale.spec.ts` measures it, in its own CI step. Checked by breaking it: putting the run
cap back to twenty takes the desktop reading to **2,795px** and fails the ratchet.

### And then the real reading, the same day

The fixture readings above were taken because the reading on ARCA's own data was recorded as blocked.
**It was not blocked.** Git is the source of truth for work items — the studio is a view over the
venture repos' `docs/tickets/` through the GitHub API, with no separate database of record — so a
local build with a real `GITHUB_TOKEN` reads exactly the data production reads. And `gh auth token`
had held `repo` scope on `wealthcx01/arca` the whole time.

| the desk, on ARCA's own data | 1440×1000 | 393×851 |
| --- | --- | --- |
| **as the founder** | **1,689px** | **2,175px** |
| as a Bruntsfield admin | 1,825px | 2,465px |

Over **73 tickets and 9,889 run reports**. Below the design's own ~1,900px, and 1,200px below where
FB-186 left the desk. Neither viewport scrolls sideways, and nothing on either screen reported a
failed read.

Take it again with `node scripts/measure-on-real-data.mjs` — see the method note above. Sign in as
the **founder**, not as an admin: an admin sees wiring warnings a founder never does, and they cost
136px on the desk.

### Every screen, on real data, 2026-09-30 (FB-175)

The full sweep, signed in as ARCA's founder over its own 79 tickets and 9,889 run reports. Taken with
`node scripts/measure-on-real-data.mjs`.

| screen | desktop | phone | verdict |
| --- | --- | --- | --- |
| Sign in | 1,000px | 851px | **matches** — compared in full by FB-189 |
| The desk | **1,689px** | **2,175px** | **under the design's ~1,900px** |
| Tickets | 1,169px | 1,474px | **matches** — and says plainly when history is unreadable |
| What happened | 1,000px | 1,014px | **wrong, FB-242** — one row over 9,889 reports, claiming completeness |
| Memory | 1,000px | 1,945px | reads as intended over 5 documents |
| Handbook | 1,000px | 1,581px | **explained** — see below |
| Composer | 1,000px | 1,014px | **matches** |
| Needs you | — | — | redirects to Tickets' "Needs you" filter, by FB-129's design |
| The ledger (`/`) | — | — | a founder with one venture is sent to its desk, by design |

No screen scrolls sideways at either size.

**The Handbook's phone height is not a fault.** FB-175 left it recorded as unexplained: 1,581px on a
phone against 1,000px on desktop. It is nine chapters. On desktop they sit in a grid; on a phone they
stack one per row at about 115px each. A list of nine things is taller in one column than in three.
Explained, and closed.

**"What happened" is the one real divergence the sweep found**, and it is the worst kind: the page
renders, in the right order, with correct data — correct about the twenty reports it read, and wrong
about the venture. Filed as FB-242.

### One thing the real reading settled that the fixture could not

On real data the rail and the body **agree** — both say *"Your team checked in 3 minutes ago"*. The
contradiction that FB-240 was filed for appears only under the pinned test clock, which confirms that
ticket's own conclusion: it is a fault in the gate, not in the product.

### Read the pictures, not only the table

`e2e/__screenshots__/20-desk-at-scale-desktop.png` and `-phone.png`, taken at these sizes. Looking at
them is how **FB-240** was found — the rail saying *"your team has not checked in for 70 days"* beside
a body saying *"your team checked in 10 minutes ago"*, both reading the same heartbeat, on a screen
whose every measurement had just come back correct.

## FB-149 — one "Needs you" number, 2026-10-01

Read on ARCA's real data, signed in as its founder, on a local build of this branch pointed at the
same GitHub repositories production reads. The desk is **1,689px** at 1440×1000 and **2,175px** at
393×851; Tickets is **1,245px** and **1,600px**. The rail's badge, the desk's sentence, the amber
banner, the phone header and the Tickets "Needs you" filter all say **9**. ARCA has no send waiting
today, so on real data the nine are all finished work.

The fixtures do hold sends, so they are where the sends were seen: all five places say **10** (four
pieces of work, six sends). Desk 2,165px / 2,368px; Tickets 1,322px / 1,701px. Before this branch
the phone header said 4 over that same desk.

Two faults were found only by looking at the pictures, and both are fixed here: a send's row read
"send · … · external send · …", and every send was labelled "Build — Product" because it was named by
the repository it came from rather than the department it names (ARCA's investor email is Sell).

### FB-149 and FB-183 after review, 2026-10-02

Built from the FB-183 branch (which carries FB-149) on the fixtures, signed in as ARCA's founder.
Desk **2,165px** at 1440×1000 and **2,368px** at 393×851 — the same as before the review fixes, so
nothing grew. Tickets is **1,322px** at 1440×1000. All places still say **10**, phone header included.

Looked at as pictures. The amber banner now reads *"6 decisions about something leaving the
company"* rather than calling all six actions that "would go outside": one of them already went out,
on an approval nobody can name. The Tickets detail for that send says so in words; the five that are
still only proposals keep "This would go outside your company". Not compared side by side with the
Claude Design artifact in this pass — the change is words inside existing rows and panels, and the
heights above show the layout did not move.

## FB-180 finished — What happened, as a story, 2026-10-02

Read on ARCA's real data, signed in as its founder, on a local build of this branch. Before (FB-242's
reading): **one row**, because the newest sixty reports were all one ticket parked again every five
minutes. After: twelve lines, one per stretch of work on one ticket, reaching back to 26 August, at
**1,236px** (1440×1000) and **2,547px** (393×851). On the UI gate's fixtures: 1,000px and 1,929px.
On the 1,773-report scale fixture: 1,137px at 1440×1000.

Compared side by side with the Claude Design artifact's "What happened" (rendered from the artifact's
saved page, since the public link needs a claude.ai sign-in): the design is **1,000px** with six
one-line rows. Ours has the same shape — a dated column, a coloured mark, a sentence, the department
on the right — with twelve rows, most of them two lines because ARCA's sentences are longer than the
design's. The design's phone view is a separate prototype ("the pocket studio"), so the phone reading
was looked at on its own: one column, nothing cut off, no sideways scroll. Sends on this page now
read "Sell — Go-to-market", not "Build — Product".

## FB-184 — "Follow it to…" on a ticket, 2026-10-02

Read on ARCA's real data as its founder, on a local build of this branch, beside the Claude Design
artifact's Tickets screen (1,090px, rendered from the artifact's saved page). ARCA-069 open:
**1,279px** at 1440×1000 and **1,968px** at 393×851; Tickets with no ticket opened: 1,209px and
1,474px. On the UI gate's fixtures, ARCA-1: 1,322px and 1,747px, the same as before this change.

Looked at as pictures. The new line sits where the design puts it, directly above "Your decision",
in bold accent text. The design's line reads "Follow it to the VM: 3 commits · preview running ↗";
ours says "the preview" instead of "the VM", leaves the commit count out, and on ARCA today says
"none has been built for this work yet", because ARCA's three open pull requests predate working
previews. The link half was checked on live previews rather than seen on ARCA's screen.

### FB-206: the credential scan on the admin ledger, 2026-10-02

Built on the fixtures, signed in as the Bruntsfield admin (this section is admin-only, so the
founder reading does not apply). The ledger (`/`) is **1,254px** at 1440×1000 and **2,570px** at
393×851; the new section is **231px** and **420px** of that. No sideways scroll on either. Signed in
as THE RESET's founder, `/` lands on `/venture/the-reset` and the section is not on the page.

Looked at as pictures. Each venture is one line under the footnotes: ARCA red with its two files
listed by path and line, Modernisation Engine amber ("21 days ago … the scanner may have stopped"),
THE RESET grey ("not the same as clean"). Long transcript paths wrap inside the column on a phone.

It reuses the footnotes' eyebrow, type sizes and state marks rather than adding a style of its own.
Noticed, not changed (out of scope): on a phone the ledger table above squeezes its seven columns
into word-per-line cells; that is the existing table, not this ticket.

**Compared with the design, after review (same day).** I opened the Claude Design artifact in a
browser at both sizes, pressed "Continue with Google", and looked at what it shows. It is the
founder's studio: it lands on ARCA's desk, and its rail holds the desk, Tickets, Needs you, What
happened, Memory and Handbook. **It has no admin ledger at all, and nothing about a credential
scan.** So there is no design for this section to match, and the honest comparison is with the
design's way of drawing things: a small coloured square before each line, an upper-case eyebrow
over the block, and thin rules between rows. The section uses all three, and nothing else. The
design is 1,922px tall on a desktop and 7,115px at phone width, because the prototype does not
reflow for a phone (its phone view is "The pocket studio"). Re-rendered the ledger after the review
fixes: still **1,254px** and **2,570px**, section **231px** and **420px**, no sideways scroll.

**Not checked on production.** The ledger is admin-only and production needs a Google sign-in this
pass does not have. And no venture box runs the new scanner yet, so on production every venture
would show the grey "not known" line; the red, amber and green lines can only be seen on fixtures
until a box reports.

## FB-248 — Scale: your ads on Meta, 2026-10-02

Read on ARCA's real data, signed in as its founder, on a local build of this branch pointed at the
same GitHub repositories production reads. **The new page, `/venture/arca/ads`, is 1,274px at
1440×1000 and 2,068px at 393×851**, with no sideways scroll on the phone (scroll width 393). The desk
is **1,881px** and **2,258px**; the only change to it is one more line in the Scale column, "your ads
on Meta →", and the Scale sentence now reads "Meta ads · not connected yet" in place of "platform tbd".

**There is no design for the ads page.** The Claude Design artifact has no ads screen; its desk draws
Scale as *"Not connected. The ad account is a Bruntsfield setup step; platform tbd."* and lists ads
among the external hops marked ↗. So the desk line was compared against that text, and the page was
built from the studio's existing parts (eyebrow, serif title, hairline card, label-over-figure, rows
divided by rules). Looked at as pictures at both sizes. One fault was found by looking and fixed: the
awareness campaign showed "£0.01 each" per person reached, which is true and meaningless; reach now
shows no price per result.

**Re-read after review, same day, beside the design.** The desk was then rendered side by side with
the Claude Design artifact's desk (from the artifact's saved page, signed in with "Continue with
Google"). Design: **1,922px** at 1440×1000. Ours on ARCA's real data: **1,845px** at 1440×1000 and
**2,258px** at 393×851; the ads page **1,274px** and **2,046px** (the example's campaign names were
made generic, which shortened two rows on the phone). In the pictures the Scale column sits where the
design puts it, last of three, with the same shape: a sentence saying it is not connected, the ticket
count, then links. Ours reads "Meta ads · not connected yet" where the design says "platform tbd",
because the platform is now chosen. The design marks its ads link ↗ as a hop outside the studio;
ours is "your ads on Meta →" because it opens a page inside the studio. The design's phone view is
the separate pocket-studio prototype; on ours the page is reached from the phone in two presses, "See
the whole desk" and then "your ads on Meta →" in the Scale column (seen in the picture). An earlier
line here said the phone had no way in; that was wrong.

## FB-141 — asking whether a phone may buzz, 2026-10-02

Read on ARCA's real data, signed in as its founder, on a local build of this branch pointed at the
same repositories production reads, in Chromium's full headless mode (the lighter headless shell
reports every notification permission as "blocked", so it can never show the card).

Tickets is **1,245px** at 1440×1000 and **1,600px** at 393×851 — unchanged on first load, because
nothing is drawn until the founder has decided something. After a decision, a card sits over the foot
of the screen and the page does not grow. A founder who pressed "Not now" sees one quiet line at the
end of the "Needs you" list instead: **1,330px** and **1,743px**. The desk is unchanged
(**1,909px** / **2,231px**) and shows nothing about notifications at all. Nothing scrolls sideways.

The design has no picture of the asking — screen 11 says only that "a push arrives the moment they
become the blocker". Its Tickets screen, rendered from `docs/design/foundry-desk/` and clicked
through, is 1,090px at desktop. The hosted design artifact could not be opened from a headless
browser here (it answered "Page not found" without a signed-in claude.ai session).

Looked at as pictures. The first draft said "this phone" on a laptop; it now says "this device".
On a phone the card covers the second and third rows of the list until it is answered.

After review, 2026-10-02: a browser test now draws the card on a phone (`e2e/push-pocket.spec.ts`)
and saves `141-push-offer-phone.png` to the UI gate's gallery. Looked at again: the card still
covers the list summary and the first rows below it on a 393px phone until it is answered. That is
left as it is, as a design decision for John — the design has no picture of the asking to compare
against. The hosted design artifact was not opened this time either: it needs a signed-in claude.ai
session, and this review had none. The live side is still a local build, not production.

### FB-236 the founding map in the composer's plan panel, 2026-10-02

Built on the fixtures, signed in as John, on ARCA's composer, with the scripted founding hand-over
(`e2e/fixtures/composer/founding.sse`). Composer page **1,347px** at 1440×1000 and **2,326px** at
393×851 with the map folded; **2,139px** and **3,248px** with the map opened. No sideways scroll at
either size. The map is folded by default for that reason: opened, it adds about 800px on desktop.

Looked at as pictures. The panel heads *"Your first tickets, from the map"*, shows the founder's idea,
one line to open the map (four parts, 12 points), then the five tickets — each naming the part of the
map it came from — and one *"File all 5"* button. **Not compared with the Claude Design artifact:**
a browser here cannot sign in to claude.ai, so the artifact returned "Page not found". The design has
no founding-map state of its own; the panel is the FB-127 plan panel with one block added above its
lines.

**Second reading, after review (2026-10-02).** Same method, on this worktree's own build with the
fixtures. Composer page with the founding set, map folded: **1,347px** at 1440×1000 and **2,305px** at
393×851 (21px shorter on the phone, because the line "From The founding map —" is gone). Map opened:
**2,139px** and **3,227px**. The new state where the map arrived but its tickets could not be read:
**1,425px** and **2,451px**; the rail shows a plain amber sentence saying the tickets are missing,
then the idea and the whole map, open. No sideways scroll in any of the six.

**Compared with the Claude Design artifact this time.** The artifact's page was read through the
artifact service, saved, and rendered in a browser here; "Continue with Google", then the desk's
*"Break the data room PRD into tickets"* prompt, reaches the design's plan state. That screen is
**1,000px** at 1440×1000 (it fits the window). At 393×851 the design does not reflow (its phone
layout is the separate pocket studio), so its 3,677px capture is not a fair phone reference.

What the two pictures show, side by side at desktop: the founding additions (the idea, one line that
opens the map) sit where the design has nothing, above the ticket lines, and do not disturb the
layout. The older differences belong to the FB-127 plan panel and are not new here: the design's
rail is a flat column under *"The plan, taking shape · draft; nothing filed"* with ticket ids and
underlined "Strike" links; ours is a bordered card with buttons, and our "File all 5" lives in the
rail where the design puts it in the conversation, beside "Change something". Ours is 347px taller,
mostly because each line also says where it came from. Closing that gap belongs to the plan panel,
not to this PR. It is not filed as a ticket here, because other open PRs are taking new numbers today.

## FB-235 — the Sell surface, a new screen, 2026-10-02

**Not compared to a design, because there is none to compare it to.** The Claude Design artifact's
rail reaches the desk, Tickets, What happened, Memory, the Handbook and the pocket studio; it has no
Sell screen. So this screen has been looked at, but it has not been verified against a design, and
nobody should read this line as saying it has. The shape comes from FB-235 (taken from the pipeline
John runs); the layout borrows the desk's own pieces — the queue heading, the surface label, the
hairline columns.

**Not read on production either.** Production has no pipeline yet: `db/005_crm.sql` (FB-234) has not
been run on the studio's database, and nothing has written a contact. So the reading is the UI
gate's fixture — fifteen invented people and sixteen deals, built to hit every cap — on the
studio's own build, signed in as ARCA's founder, landing on `/venture/arca/sell`.

- Sell, with the fixture: **1,311px** at 1440×1000 and **2,814px** at 393×851. No sideways scroll.
- Sell, with no database: **1,000px** and **1,014px** (one sentence saying it is not set up yet).
- The desk, which gains one link ("your pipeline →") in the Sell column: **2,188px** at 1440×1000
  (was 2,165px) and **2,368px** at 393×851 (unchanged).

Looked at as pictures. On a desk the page is one screen and a third: five people who need the
founder, each with a coloured edge for how warm they are, then six stage columns ending in Won. On a
phone the board stacks, and it is the long part — every stage shows up to three deals, one under the
other. If that proves too long in use, showing counts only on a phone is the next step.

Read again after review, 2026-10-02, on the same fixture (now fifteen people: one has no deal, so
the people count and the open-deal count differ) and the same build setup, signed in as ARCA's
founder, landing on `/venture/arca/sell`: **1,311px** at 1440×1000 and **2,814px** at 393×851, the
same as before, no sideways scroll. Looked at as pictures: the summary now reads "15 people, 14 open
deals", and Ben's row still quotes his own message, not the note logged after it. The page for
another venture (`/venture/the-reset/sell`, as ARCA's founder) shows the "No access" notice:
**1,000px** and **851px**. Still not compared to a design, for the reason above.

## FB-179 — "Go to anything", 2026-10-02

Read on ARCA's real data, signed in as its founder, local build of this branch. The palette draws
nothing until it is opened, so no screen changed height: the Handbook is **1,000px** at 1440×1000 and
**1,581px** at 393×851 with it closed. Open, it is a box over the screen — 40rem wide on a desktop,
the full width less 16px each side on a phone — and the page behind does not move.

Looked at as pictures, at both sizes. On a phone the first draft put the hint beside the title and
left the title one word wide ("build…"); the hint now goes underneath. The design has no palette; it
is new, built from the same hairline, square, no-shadow rules as the rest of the studio.

After review, 2026-10-02: a browser test (`e2e/palette.spec.ts`) now drives the palette with the
keyboard only and saves `179-palette-desktop.png` to the UI gate's gallery. The hosted design
artifact was not opened: it needs a signed-in claude.ai session, and this review had none. It has
no palette to compare against in any case. The live side is still a local build, not production.

## FB-173 — a voice note in the composer, 2026-10-02

Read on ARCA's real data, signed in as its founder, local build, with Chromium's simulated
microphone (it plays a tone, so the meter has something to show). The upload was answered inside
the browser, so no recording went to any outside service during this reading.

The composer is **1,000px** at 1440×1000 — the button and its one paragraph fit inside the first
screen — and **1,193px** at 393×851, **1,224px** while recording. Looked at as pictures: the meter
moves, the clock counts, the words land in the box after what was typed, and with the network cut
the failure says the recording is saved on this device and offers it again after a reload. The first
draft said the words appear "in the box below" from a paragraph that sits under the box; it now says
"in the text box", and the paragraph is shorter. The design's composer has no record button; it is
the one addition, under the existing two.

After review, 2026-10-02: the failure after an expired sign-in now reads "You need to sign in
again. The recording is saved on this device — sign in, come back here, and it will be offered
again", with "Try again" and "Throw it away" under it. Looked at as pictures on a local build with
fixture data: the composer is **1,000px** at 1440×1000 and **1,169px** at 393×851 in that state, and
nothing scrolls sideways. A browser test (`e2e/voice.spec.ts`) now draws the record button in the UI
gate, using the test transcriber. The hosted design artifact was not opened: it needs a signed-in
claude.ai session, and this review had none. Its composer has no record button to compare against.

## FB-150 — the text boxes get their border back, 2026-10-02

Read on a local build with the UI gate's fixture data, not production, before and after the change,
at 1440×1000 and 393×851. Before: the composer's text box had no border and no background of its
own — an unmarked strip on the page. After: it has the studio's 1px border and its raised paper
background, like the cards beside it. The same fix gives a border back to the folded-away ticket
draft, the lines of the plan panel, and the full record on a piece of work.

Heights after (before in brackets): composer, empty, **1,000px** (1,000) at desktop and **1,284px**
(1,282) on a phone; composer with the draft open **1,295px** (1,291) and **2,391px** (2,387); composer
with a plan **1,227px** (1,225) and **2,546px** (2,539); a piece of work with its record open
**2,136px** (2,134) and **4,179px** (4,177). Each grows by its new borders and nothing else. The
hosted design artifact was not opened for this reading: the change restores what the components
already asked for and changes no layout, and the ticket rules a different look out of scope.

**Taken again after review, 2026-10-02, on real data beside the design.** Read on ARCA's real data,
signed in as its founder, on a local build of this branch pointed at the real GitHub data (the
method at the top of this file), beside the Claude Design artifact rendered from its saved page and
clicked through ("Continue with Google", then the desk and "The pocket studio"). Looked at as
pictures at 1440×1000 and 393×851.

- Composer, empty: **1,000px** at desktop and **1,195px** on a phone. No sideways scroll. The text
  box has a 1px border and the raised paper background (the browser drew `solid 1px #dddbd6` on
  `#fdfcfa`).
- A piece of work (ARCA pull request 93) with its full record open: **3,550px** and **7,218px**. No
  sideways scroll. The record has its border and background. It is long because that record is long:
  the founder asked to see all of it, and before that it is folded away.
- The composer with a ticket draft open, and with a plan proposed, could not be drawn on real data.
  Those states need the composer's conversation service, which runs on the venture's box and not on
  a local build. They were drawn on fixtures only (the heights above).

What the comparison found: the design draws its "Tell the studio what you want" box with the same
shape — a 1px solid line around a pale box — but with the **darker** line, `#b9b6ae`, which is our
`--color-border-strong`. Ours now uses `--color-border` (`#dddbd6`), as the ticket asked. So the box
is back, but its line is lighter than the design's. The ticket rules a different look out of scope,
so this is left as a follow-up, not changed here. Two things seen that this change did not cause:
the design's composer puts Send inside the box, where ours puts it underneath; and on a phone the
full-page capture draws the top bar part-way down the composer, which is how a full-page screenshot
shows a bar that stays at the top while you scroll.

## FB-241 — every time on the desk from one clock, 2026-10-02

Read on a local build with the UI gate's fixtures and its pinned clock (`E2E_NOW`), signed in as
John, before and after the change. Both were looked at as pictures.

**Before:** the desk said *"Your team checked in 10 minutes ago"* above run rows reading *"72 days
ago"*, an office ledger reading *"· 72 days"*, a waiting row reading *"waiting 79 days"* and a
banner saying *"the oldest piece of work has waited 79 days"*. Five times, two clocks. The page was
**2,324px** at 1440×1000 and **2,658px** at 393×851.

**After:** the rows read *"10 minutes ago"*, *"1 hour ago"*, *"2 hours ago"*, *"5 hours ago"*; the
ledger *"· 10 minutes"*; the waiting row and the banner both *"7 days"*. Every time on the page now
agrees with the sentence above it. **2,342px** at 1440×1000 — 18px taller, because *"10 minutes
ago"* wraps onto two lines in the run list's narrow first column where *"72 days ago"* fitted (filed
as FB-262) — and **2,658px** at 393×851, unchanged. The phone desk does not show the run list; its
two times, the banner and the waiting row, both say 7 days.

Not compared with the design artifact (it needs a signed-in claude.ai session, which this run did
not have), and not read on production: `E2E_NOW` is never set there, and on 2026-09-30 ARCA's real
rows were already seen agreeing with the check-in sentence beside them.

**After review, 2026-10-02.** The Sell line in "The company, by surface" was the one time left on
the desk worked out in the browser. Under the gate's pinned clock it now says *"Last send went out 3
days ago"*: the fixture's send went out on 18 July and the pinned "now" is 22 July. Before, the
browser used the real clock and would have said about 76 days. Read on a local build with the gate's
fixtures, signed in as John, and looked at as pictures: **2,342px** at 1440×1000 and **2,658px** at
393×851, both unchanged. The phone desk does not show the surfaces, so the Sell line is not on it.

Compared with the design this time. The artifact's page was read through the studio's artifact tool
and rendered locally with Playwright, signed in through "Continue with Google". Its desk is
**1,922px** at 1440×1000; ours is **2,342px**, 420px taller. The extra height is three things the
design does not have: the "2 tickets are stuck" banner, the fixture's red warning that the venture's
composer key is missing, and longer surface lines. The order of the sections matches. Every time in
the design agrees with the others (*"2 minutes"*, *"3 days"*), and every time on ours now does too.
The design has no phone layout for the desk: at 393×851 it squeezes the desktop page into a narrow
column, 7,115px tall, so there is nothing to compare our phone desk against. Its phone screen is the
pocket studio.

Still not read on production. The ticket says so.

## FB-149 finished for an admin — the cross-venture "Needs you", 2026-10-02

Signed in as an admin (John), local build of this branch. On the UI gate's fixtures, `/attention` is
**1,366px** at 1440×1000 and **2,182px** at 393×851; ARCA's desk is **2,324px** and **2,658px**. On
ARCA's real data (the same repositories production reads), `/attention` is **1,458px** and
**2,299px**; the desk is **1,984px** and **2,548px**. Nothing scrolls sideways at either size.

The header badge, the page's number and ARCA's desk sentence all say **10** on both. Before this
branch, on the fixtures, the header and the page said 4. On real data ARCA has no send waiting, so
the ten are finished work and the page looks as it did, with the same number.

Looked at as pictures. On the fixtures the six sends sit first under "About to leave a company",
each with a "send" tag, its venture, "Sell — Go-to-market" and its state; the four pieces of
finished work follow under "Finished work, oldest first". On a phone each row wraps to three or four
short lines and nothing is cut off. Not compared with the Claude Design artifact: the design has no
cross-venture page (its rail reaches Tickets, What happened, Memory, Handbook and the pocket studio),
so there is nothing to put beside it. The live side is a local build on real data, not production —
this session cannot sign in to production as an admin.

## FB-169 — the Memory screen says which documents the team cannot find, 2026-10-02

One sentence was added under the Memory table. Read two ways, on a local build of this branch,
signed in as ARCA's founder, landing on `/venture/arca/knowledge` both times:

- **ARCA's real data** (a GitHub access key read from this machine, so it reads what production
  reads). The box does not write the new record yet, so the sentence says "Nothing checks yet
  whether your team can find every document here…". **1,187px** at 1440×1000 and **2,239px** at
  393×851. No sideways scroll.
- **The UI gate's fixture**, which has a record saying one of four documents cannot be found. The
  sentence is in the warning colour and names it: "Your team cannot find 1 document of your 4 …
  It is: Set naming decision." **1,060px** at 1440×1000 and **1,878px** at 393×851. No sideways
  scroll.

The sentence adds two lines on a desktop and four on a phone. The real-data heights are above the
scorecard's 1,096 / 1,988 because ARCA now has five documents with longer titles, not because of
this sentence.

Compared with the design: a saved copy of the Claude Design artifact, opened in a browser, signed in
with "Continue with Google" and clicked to Memory. It is **1,000px** at 1440×1000 and **2,103px** at
393×851. Looked at as pictures, side by side. The design has no such sentence; its table answers a
related question per row ("Not cited yet"). The new sentence sits where the screen's other notes
already sit, under the table and above "What happens without you asking", in the same small type.
The saved copy is from 2026-10-02 01:16; the hosted artifact itself was not reopened.

**After review, 2026-10-02.** The sentence can now add one more clause: how many documents in the
table the check does not count (another surface's documents, or a folder's own README). Rendered on
a local build of the branch, signed in as ARCA's founder, landing on `/venture/arca/knowledge`:

- **The UI gate's fixture, unchanged:** **1,060px** at 1440×1000 and **1,878px** at 393×851, the
  same as before review. The new clause does not appear, because every listed document is checked.
- **The fixture plus one folder README** (`context/sell/README.md`), to see the new clause: **1,175px**
  and **2,090px**. Most of the extra height is the README's own row and the "could not be read just
  now" note it brings. The clause adds one line on a desktop and two on a phone. No sideways scroll.
  The wording was then shortened to "One more document listed above is not part of this check…"; that
  final wording was checked by the unit tests, not re-rendered.

ARCA's real data was not re-rendered: with no record from the box yet, it shows the "Nothing checks
yet" sentence, which this change does not touch. The design was not reopened for this pass.

## FB-184 second pass — "see it" links are opened first, 2026-10-02

Signed in as an admin, local build of this branch. On the UI gate's fixtures: the cross-venture
queue is **1,000px** at 1440×1000 and **1,104px** at 393×851; the desk **2,324px** and **2,658px**;
the work page for pull request 11 **1,000px** and **1,021px**; Tickets with ARCA-3 open **1,359px**
and **1,822px**. On ARCA's real data: the queue **1,436px** and **2,299px**, the desk **1,984px** and
**2,548px**. Nothing scrolls sideways.

Looked at as pictures. On the fixtures the queue shows "see it running ↗" on ARCA-5 (its preview
opens), a quiet "preview: it did not open when the studio checked, because it is not answering" on
Deck export, and nothing on ARCA-1 (never checked). The work page shows both buttons when both open.
With every check set to fail (a second fixture, for the pictures only), the work page and the
desk's Build column say why in a muted line and draw no link, and the Build line drops "preview of
the app running". On real data the two previews ARCA has were opened live and both show their tag.

The heights match the same screens before this change. Not compared with the Claude Design
artifact: the change is one tag or one line inside existing rows, and this session had no signed-in
claude.ai session to open the artifact. The live side is a local build on real data, not production.

## FB-184 after review — beside the design, and with every check failing, 2026-10-02

The review said the desk had not been put beside the design. It has now. The design artifact was
read through the studio's artifact tool (the owner's own copy), opened in a browser, signed in with
its "Continue with Google", and its desk captured at both sizes. The studio side is a local build of
this branch on the UI gate's fixtures, signed in as ARCA's founder. It is not production: this
session cannot sign in to production.

Heights. Design desk: **1,922px** at 1440×1000. At 393×851 the design's desk is **7,115px**, because
the design does not lay its desk out for a phone; its phone screen is the separate pocket studio, so
that number is not a target. Studio desk: **2,188px** and **2,368px**. Work page for #13: **1,000px**
and **1,014px**. Work page for #11: **1,000px** and **1,014px**. Cross-venture queue: **1,366px** and
**2,231px**; with every check failing, **1,396px** and **2,245px** (one extra quiet line). Nothing
scrolls sideways at either size.

Looked at side by side. The design's Build column reads "14 tickets · preview of the app running
from the venture VM", then "Open the app ↗". The studio's reads "6 tickets · preview of the app
running from the venture machine", then "Open the terminal ↗" — the same line and the same link,
with ARCA's own label. With every check set to fail, the studio's Build column drops "preview of the
app running" and shows, in the muted colour, "Open the terminal: it did not open when the studio
checked, because it is not answering." **The design has no failing state for a door.** Its rule for
the ticket line is "render nothing when the link cannot be formed"; the studio draws no link, but
does say why in one quiet line, because a founder who expects the button should not have to guess
where it went (non-negotiable 10). That is a choice John may want to overrule. The design's second
link, "changes on the VM ↗", is not in the studio; it needs the commit count FB-184 still leaves.

The work page for #13 shows "Open the terminal ↗" and, under it, "The preview of this change: it did
not open when the studio checked, because it is not answering." With every check failing, both are
sentences and there is no button; on a phone they wrap to two lines each and nothing is cut off.

## FB-263 — a hyphenated ticket prefix, 2026-10-21

FB-263 changes how four places read a ticket id, so that THE RESET's ids (`THE-RESET-012`) are read
as whole ids, the way ARCA's (`ARCA-012`) already were. Two screens show that text: "What happened"
and the composer's side panel.

**The fix itself cannot be seen on a screen yet.** THE RESET is parked and has no data, and no
fixture has a hyphenated id. The fix is proved by unit tests instead: one per place, and each one
fails when the old pattern is put back. The pictures below only show that ARCA did not change.

Read on a local build of this branch, signed in as ARCA's founder, on the UI gate's scale fixture
(73 tickets, 1,773 run reports: ARCA's real numbers). **Not production, and not ARCA's real data:**
this machine had no GitHub key that session, so it could not read what production reads.

- "What happened", landing on `/venture/arca/activity`: **1,137px** at 1440×1000 and **2,203px**
  at 393×851. Twelve rows, ids such as "Worked ARCA-17 — …" read whole. No sideways scroll.
- Composer, landing on `/venture/arca/composer`: **1,000px** at 1440×1000 and **1,195px** at
  393×851. The side panel says "Nothing on the table", because no draft is being written. No
  sideways scroll. On a phone the page scrolls down to the text box when it opens, so a full-page
  picture draws the fixed top bar in the middle; a picture from the top shows the page laid out
  correctly. That behaviour is older than this ticket.

**Not put beside the design this time.** The design link needs a claude.ai sign-in this session did
not have, and no saved copy was on this machine. The design's heights from the scorecard are
~1,000px for both screens at desktop size. Against the scorecard's last studio readings:

- "What happened" is lower at both sizes: 1,137px against 1,236px, and 2,203px against 2,547px.
- The composer is lower at desktop size (1,000px against 1,096px) but **higher on a phone: 1,195px
  against 1,142px, 53px more.** This ticket changes no layout and no styles, only how an id is
  read, and the side panel showed no ids in this reading. The cause of the 53px was not looked into.

## FB-274 — the Review screen, a new screen, 2026-10-29

The design is the "Studios, aligned" canvas's three Review artboards (`foundry-review`,
`foundry-review-phone`, `foundry-review-cards`), not the prototype named in `CLAUDE.md` rule 11.
They were rendered with the canvas's own runtime, served from a saved copy, signed in as nobody.
The build was read on a test copy of this branch (`scripts/test-copy.mjs`), on the rig's two ARCA
cards, as ARCA's founder and as John, before and after each press. **Not production:** until
FB-275 there are no cards outside a test copy.

| Screen | Design, 1440×1000 | Build, 1440×1000 | Design, 393×851 | Build, 393×851 |
| --- | --- | --- | --- | --- |
| Founder, waiting | 1,648px | 1,357px | 851px (fixed screen) | 1,626px |
| Founder, notes pinned | 1,648px (3 notes) | 1,545px (2 notes) | 851px | 1,729px |
| Founder, signed off | 1,554px | 1,319px | 851px | 1,595px |
| John, after the sign-off | 1,706px | 1,427px | — | 1,802px |
| Sent back | — | 1,517px | — | 1,604px |
| Part of the product | — | 1,361px | — | 1,529px |

The build is shorter at desktop size because its test pictures are plain, and taller on a phone
because a whole phone screenshot is taller than the design's drawn one, and because it keeps the
summary and the notes box, which the phone artboard leaves out.

Where it differs from the canvas, and why:

- **The rail is the studio's own.** The canvas draws a forest-green rail; changing the rail changes
  every screen, which this ticket rules out ("the desk's layout doesn't change").
- **Notes can be pinned on all four pictures.** The canvas says notes go on the computer picture
  only; journey 4 pins one on the phone "after" picture.
- **John reads the founder's notes as text,** not as pins on his picture. Pins are kept with the card
  once the card store exists (FB-275).
- **No "Take my sign-off back".** There is no press for it yet. "Decision 9 of 11" and "builds on
  ARCA-069" are not shown: nothing records them yet.
- **The pictures are test drawings,** drawn by the studio from the card's words. Real pictures come
  from the planning box (cowgate CG-0065) and live in the studio's database, never in git.

## FB-276 — the Review screen's states after a press, 2026-10-29

No new screen and no new layout. The Review screen's state now comes from the press store and the
factory's answers, so its settled panel has four new readings: approved and waiting for the factory,
part of the product (with what the factory said), nothing was done (the factory said it was out of
date), and rejected, stopped, sent to try again or sent to be split (here, or on Telegram). Each is
drawn with the existing "Sent back" and "Part of the product" panels. Rendered on Playwright's own
studio, this branch beside `main` (70621dc), on the rig's ARCA cards, as ARCA's founder and as John.
**Not compared with the canvas:** the canvas has no artboard for these states. Not production.

| Screen | `main`, 1440×1000 | Build, 1440×1000 | `main`, 393×851 | Build, 393×851 |
| --- | --- | --- | --- | --- |
| Founder, waiting | 1,347px | 1,347px | 1,675px | 1,675px |
| Founder, signed off | 1,319px | 1,319px | 1,595px | 1,595px |
| John, after the sign-off | 1,413px | 1,413px | 1,802px | 1,802px |
| John, just approved | 1,361px ("Part of the product") | 1,361px ("Approved · waiting for the factory") | 1,529px | 1,559px |
| John, part of the product, with the factory's answer | — | 1,361px | — | 1,565px |
| Founder, part of the product | — | 1,319px | — | 1,565px |
| Founder, rejected on Telegram | — | 1,329px | — | 1,448px |
| John, nothing was done (out of date) | — | 1,361px | — | 1,499px |

Where it differs from before, and why:

- **John's Approve no longer says "Part of the product" at once.** The studio only records the
  press now; the factory does the merge. Until it says so, the flag reads "Approved · waiting for the
  factory" and the panel "The factory makes it part of the product next."
- **John's Reject, Try again, Split it and Stop have no buttons.** The canvas draws none, so they are
  built on the server and in the door only. Pressed on Telegram, they show on the card.

## FB-277 — factory cards in "Needs you" and "What happened", 2026-10-29

No new section and no new layout. The factory's cards are rows of lists that already exist: the
desk's "Waiting on you", the Tickets screen's "Needs you", "What happened", and for John the
cross-venture "Needs you" (`/attention`) and "What has been happening" (`/activity`). The design is
the "Studios, aligned" canvas's desk, tickets, activity and phone boards, rendered with the canvas's
own runtime. The build was read on Playwright's own studio, this branch beside `main` (6290e56), with
the stand-in's journey 3 cards sent through the door: ARCA finished (two), ARCA stuck, THE RESET
finished and cowgate done. As ARCA's founder and as John. **Not production:** there are no cards
outside a test copy yet.

| Screen | Design, 1440×1000 | `main`, 1440×1000 | Build, 1440×1000 | Design, 393×851 | `main`, 393×851 | Build, 393×851 |
| --- | --- | --- | --- | --- | --- | --- |
| Desk, founder | 1,671px | 2,206px | 2,233px | 851px (fixed screen) | 2,368px | 2,396px |
| Desk, John | — | 2,342px | 2,370px | — | 2,658px | 2,704px |
| Tickets "Needs you", founder | 1,216px | 1,391px | 1,695px | 2,255px | 1,790px | 2,104px |
| Tickets "Needs you", John | — | 1,428px | 1,788px | — | 1,880px | 2,249px |
| What happened, founder | 1,084px | 1,000px | 1,079px | 1,539px | 1,929px | 2,264px |
| What happened, John | — | 1,039px | 1,218px | — | 2,071px | 2,426px |
| `/attention`, John | — | 1,366px | 1,783px | — | 2,231px | 2,958px |
| `/activity`, John | — | 1,477px | 1,812px | — | 2,178px | 2,758px |

Each page grows by its new rows and nothing else: three card rows on Tickets (about 100px each),
three lines on "What happened", four on `/activity`, and three cards on `/attention`. The desk grows
by 27px, because the stuck line now names a third ticket and wraps to two lines. No sentence is
repeated, and no piece of work appears twice: where GitHub and the factory both know a pull
request, only the card's row is shown.

Where it differs from the canvas, and why:

- **The desk shows one card, not three.** The canvas folds every send into one row ("Five things
  wait for a yes"); the studio still lists sends one by one, as it did before this ticket, so with
  four rows on the desk the sends take three. The rest are one press away in "Needs you". Folding
  the sends is a desk change, which this ticket rules out.
- **"finished, waiting for your OK" on Tickets too.** The canvas says "needs your OK" there and
  "finished, waiting for your OK" on the desk. One phrase for one state, everywhere.
- **A finished card's detail on Tickets points at its Review screen** rather than drawing the
  canvas's decision panel. The Review screen is where a card is decided (FB-274).
- **John reads the cost on each row**, after the state, and the next step on Tickets and
  `/attention`. The canvas has no John boards for these lists; nothing new was added for it.
- **"What happened" keeps its twelve rows for the record and gives the factory's newest six lines
  room of their own**, so a busy factory never pushes a founder's own decisions off the page.

## FB-281 — the work page's tag after a Send back, 2026-10-30

No new screen and no new layout: one word changes. After a Send back, the tag beside the decision
on the work page said "accepted". It now says "sent back". Rendered on a test copy of this branch
(`scripts/test-copy.mjs`), on the rig's ARCA work, after each of the three decisions. The work was
put in as a factory card first, so each press went through and drew its tag. Each picture was
looked at. **Not compared with the canvas:** the canvas has no artboard for a work page after a
press. Not production: a press there is a real decision on ARCA's work.

| After | Tag | 1440×1000 | 393×851 |
| --- | --- | --- | --- |
| The founder's Send back (pull request 10) | "sent back" | 1,346px | 1,995px |
| The founder's Accept (pull request 13) | "signed off" | 1,000px | 1,014px |
| John's Accept (pull request 10) | "accepted" | 1,383px | 2,104px |

Nothing scrolls sideways at either size. Each tag sits beside its own confirmation sentence, as
before.

## FB-278 — the Review screen when the factory goes quiet, 2026-10-30

No new screen and no new layout. Three readings of the Review screen are new. **Quiet:** the
factory has not reported for five minutes. The line "The factory hasn't reported since 15:15. These
may be out of date." is the first flag, both buttons are greyed (on a phone, in the bottom bar too),
and the decision panel says why above them. **Lapsed:** the last decision went 10 minutes without
the factory taking it or answering it. The flag reads "Nothing was done", the panel says what
happened above the buttons, and the buttons are back. **The Tickets screen's card detail** carries
the same quiet line, drawn as its other warnings are. Rendered on Playwright's own studio from this
branch, on the rig's ARCA cards (#20 waiting, #21 approved by John and never collected, read 10
minutes later), as ARCA's founder and as John. Each picture was looked at.
**Not compared with the canvas:** this run could not sign in to the design artifact, and the canvas
has no artboard for these states. **Not production:** no founder session, and there are no cards
outside a test copy yet.

| Screen | 1440×1000 | 393×851 |
| --- | --- | --- |
| John, waiting (#20) | 1,405px | 1,685px |
| Founder, waiting (#20) | 1,357px | 1,626px |
| John, quiet (#20) | 1,502px | 1,786px |
| Founder, quiet (#20) | 1,387px | 1,727px |
| John, lapsed (#21) | 1,450px | 1,790px |
| Founder, lapsed (#21) | 1,366px | 1,731px |

Nothing scrolls sideways at either size. Quiet adds the flag and the one-sentence reason (30 to
100px); lapsed adds one sentence above the buttons and the same sentence in "Follow the change".
The quiet line is not on the Tickets list's rows, only on a card's detail.

**Second round, same day.** The quiet line now also stands above the cards on the desk ("Waiting on
you"), on "What happened" (the venture's and the studio-wide one) and on "Needs you"; and on the
work page of a pull request the factory has a card for, Accept and Send back are greyed with the
line and the reason beside them. Rendered on the rig, quiet, as ARCA's founder (desk, What happened)
and as John (Needs you, the studio-wide What happened). Each picture was looked at: one amber
sentence in a bordered box, nothing else moves. The work page was not rendered: the rig has no pull
request the factory has a card for (`decision.test.ts` draws it). Not compared with the canvas or
production, for the reasons above.

| Screen, quiet | 1440×1000 | 393×851 |
| --- | --- | --- |
| Founder, the desk | 2,293px (+60) | 2,477px (+81) |
| Founder, What happened | 1,132px (+53) | 2,339px (+75) |
| John, Needs you | 1,843px (+60) | 3,039px (+81) |
| John, What happened (all ventures) | 1,868px (+56) | 2,835px (+77) |

The figure in brackets is what the line adds to the same page while the factory reports. Nothing
scrolls sideways at either size.
