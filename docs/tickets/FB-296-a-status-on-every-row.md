# FB-296 — Every ticket row says where it stands, and "Underway" counts only real work

**Status:** Done · **Size:** medium · **Budget:** none (built by Claude by hand) · **Rough date:** Wednesday 4 November 2026, before the ARCA demo on Monday 9 November · **Asked by:** John, 3 November 2026 ("then the status on each row") · **Repo:** fountainbridge · One ticket = one branch = one PR.

## Why

- The Tickets list showed no status on a row. You had to open a ticket to find out where it stood.
- "Underway" counted every ticket that was neither waiting for the founder nor done. So ARCA's
  planned work, and tickets whose files said "In progress" but that nobody had touched for months,
  were all counted as underway. The desk said "your team is on 1 moving ticket" for the same reason.
- A ticket whose status says "Stopped" (ARCA-068 to ARCA-072) didn't match any known status, so it
  was read as "To do", with a warning.

## What changes

- **Each row says where it stands**, in one of these: Waiting for you, Waiting for John, Being built,
  Stuck, Not started, Done, Stopped. A send and a factory card already say it in their own words, so
  they keep those. The ticket's detail panel says the same word.
- **"Being built" needs evidence:** a run of the venture's own machine that is going, or a factory
  card that is moving (approved, being tried again, or sent back to the team). "In progress" written
  in a ticket file is not evidence, so such a ticket reads "Not started".
- **The tabs:** Needs you, All, Being built, Not started, Done and stopped. "Underway" is renamed
  "Being built" and counts only the above. "Not started" is new and holds the rest, so the tabs
  still add up to the total. A stuck ticket is under "Not started", with "Stuck" on its row.
- **The list's sentence** uses the same words: "14 tickets: 10 waiting on you, 1 being built, 2 not
  started and 1 done or stopped."
- **The desk's sentence** counts moving tickets the same way.
- **The ticket reader** understands Stopped, Cancelled, Dropped, Won't do and Superseded. Such a
  ticket is grouped with finished work (it is settled), and its row says "Stopped", not "Done". The
  ticket contract (bcap-contracts, pinned) is unchanged.

## Acceptance

- [x] Every row on Tickets shows its status word (pictures at 1440×1000 and 393×851).
- [x] A ticket file saying "In progress" with no run behind it reads "Not started", not "Being
  built" (`lib/__tests__/tickets-view.test.ts`, `ticket-progress.test.ts`).
- [x] The five tabs add up to the total.
- [x] A "Stopped" ticket is settled, says "Stopped", and has no warning
  (`tools/ticket-parser/test/parse.test.ts`).
- [x] Every unit test and every browser test passes.
