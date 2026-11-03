# Mission: Foundry Studio

## What it is

Foundry Studio is where a founder runs a company that Bruntsfield Capital builds with them. Its
codename is fountainbridge. It runs on Railway. Production is at its Railway address until its
new address, thefoundry.bruntsfield.capital, is working. Staging is at https://foundry-studio-staging.up.railway.app.

A founder signs in and lands on their venture's page, "the desk". It answers one question first:
does anything need me? From there they decide on work, tell the studio what they want, and read what
their team did ("What happened"). John, as the Bruntsfield partner, sees every venture.

**This pilot does two things.** The factory learns to build and check the studio. And the factory's
work shows inside each venture, where the founder already looks:

- Factory work appears in the venture's existing "Needs you" and "What happened". There is no
  separate factory page.
- Each finished piece of work gets a **Review screen**: a live preview, before and after screenshots
  at desktop and phone size, a plain-English summary, and a place to leave feedback on the picture.
- A founder gets a short message on their phone when one of their cards needs them (FB-279).
- John gets the same cards and buttons in the studio as on Telegram. A press in one place goes
  through the same path as a press in the other, so the two never disagree.

The demo runs on ARCA, the test-bed venture. Its founder is Matthew, signing in with Google as
`matthew@bruntsfield.capital`. That address is in no admin list, so it sees ARCA only.
THE RESET follows later.

## Who it is for

Founders of Foundry ventures, and John. No page is public.

## Done, for this pilot

- Every journey in `harness/END-TO-END.md` passes against a test copy.
- John has clicked through staging as himself and as ARCA's founder.
- One real piece of factory work on ARCA has been signed off on its Review screen by ARCA's founder,
  and approved by John.

## Always

- **Only John approves a merge,** including a founder's own venture's work. This replaces the old
  `CLAUDE.md` rule 2, which let a founder's approval in the studio merge.
- **A founder may Stop their own venture's run, send it back with a note, or Accept it.** Accept is
  their sign-off: the card says "Signed off by <founder>, waiting for John", and it merges nothing.
  Every other button is John's.
- **A founder reads plain English.** No dollar figures, and none of the lines written for John.
- **Venture isolation is checked on the server.** A founder's request for another venture's work
  gets nothing, by any route.
- Every screen is built against its Claude Design screen. It is looked at beside that design at
  1440×1000 and 393×851, with its height recorded.

## It must never become

1. **A window into another founder's venture.**
2. **A second engine.** The studio never runs, approves or merges factory work itself. It hands each
   press to the factory's own listener on the planning box.
3. **A way round the gates.** No factory button approves an email, a payment, a post or a deploy.
   Those still need the studio's signed approval (`docs/the-record.md`).
4. **A place for secrets.** This repository is public. No keys, no screenshots of a venture, and no
   real founder data in its fixtures.
5. **A new desk.** The desk's layout doesn't change in this pilot. D10, which would make the desk
   read-mostly, is still John's decision.
6. **A redesign.** No screen is built before its design exists.

## Decisions only John makes

Every merge. Each issue's budget. Which ventures the factory works on. The founder-facing words.
Railway settings, domains and DNS. D10.
