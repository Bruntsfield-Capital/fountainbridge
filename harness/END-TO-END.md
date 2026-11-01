# End to end: what a founder and John do in the studio

Journeys 1 and 2 are the studio today. Journeys 3 to 7 pass once their steps in
`docs/prd/factory-pilot-release.md` are merged. A journey that changes is updated in that issue's
pull request, with John's approval, because `harness/` is a protected path.

**The test copy** is a fresh copy of the studio for each run, with its own throwaway database on
the planning box. It reads the test fixtures, not GitHub. People sign in through the test sign-in
door (`E2E_TEST_LOGIN` and its secret). Founder A is ARCA's founder,
`arca.founder@bruntsfield.capital`. Founder B is THE RESET's, Ross (`ross@bruntsfield.capital`),
here as a fixture only. John is the address in `STUDIO_ADMIN_EMAILS`.

**Recorded** means the studio's server accepted it. In the test copy, each decision and press is
also written as one line to a file in its state folder. **The stand-in factory** is a program the
checker runs in place of the planning box. It sends cards, preview addresses and screenshots
through the box's door, and collects presses. Its preview address is allowed in the test copy only.

## 1. A founder arrives at their own venture

ARCA's founder opens the studio while signed out, and is sent to `/login`. They sign in and land
on ARCA's desk.

**Checked by:** after sign-in, `/` leads to `/venture/arca`, and the page names no other venture.

## 2. John sees every venture

John signs in and sees the ledger, with a row for each venture.

**Checked by:** a row for every venture in `ventures/` except the example.

## 3. A founder sees factory work where they already look

The stand-in sends four cards: ARCA finished, ARCA stuck, THE RESET finished, and cowgate done.
ARCA's founder opens their desk, "Needs you", and "What happened".

**Value:** ARCA's two cards are there, in plain English. John sees all four, in Telegram's words, with
costs.
**Checked by:** the founder's pages contain no dollar figure, no "What to do next" line, no "Tell the lane"
and no link to Archon.

## 4. The Review screen

ARCA's founder opens ARCA's finished card. Its Review screen has:

- a preview link that opens the change;
- four screenshots: before and after, at desktop and phone size;
- a plain-English summary.

They click a spot on the phone "after" picture, types "The button is cut off here", and sends it
back.

**Value:** one note, recorded once, naming the picture and the spot. The card now reads "sent
back". Nothing was merged.
**Checked by:** the preview link answers. The four pictures load at their sizes. The stand-in
collects exactly one Note.

## 5. A founder accepts, John approves

ARCA's founder presses Accept on another finished card. It is recorded as their sign-off, and the
card says "Signed off by <founder>, waiting for John". It merges nothing. The stand-in collects nothing. John presses Approve. The stand-in collects one
Approve, reports back, and the card shows the result with no buttons. Pressed again, it says: "This
card is out of date: the run isn't waiting at it any more. Nothing was done." A press reported from
Telegram also shows here.

**Checked by:** one sign-off and one Approve in the state folder. The founder calling Approve
directly is refused, and nothing is recorded.

## 6. Founder A can't see or press founder B's work

ARCA's founder tries to reach THE RESET's card and its Review screen four ways:

- in their lists;
- by typing their addresses;
- by calling the studio's press door directly, with the card's id;
- through `/venture/the-reset`.

Each way gets nothing. The cowgate card never shows to a founder either.

**Checked by:** a typed-in address gets the same answer as an id that doesn't exist. No press is
recorded. The stand-in has nothing to collect. THE RESET's card is unchanged.

## 7. The factory goes quiet

The stand-in stops reporting. After five minutes, the cards say: "The factory hasn't reported since
10:42. These may be out of date." The buttons switch off, and the page says why. A press the factory
never collected ends with "Nothing was done." So does a press it collected and never answered, 10
minutes after it was collected; if the stand-in's answer comes later, the card shows that answer
instead. Either way the card's buttons come back. When the stand-in reports again, the buttons come
back.

**Checked by:** the line and the switched-off buttons, before and after. A press made while the
stand-in is quiet is refused, and nothing is recorded.
