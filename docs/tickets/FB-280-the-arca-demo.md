# FB-280 — The demo on ARCA

**Status:** Todo · **Kind:** medium · **Budget:** $25 · **Rough date:** Monday 9 November 2026 (John, 2 November 2026: the weekdays hold) · **Pilot step:** 9 · **Raised by:** John, 28 October 2026 (the factory pilot, `docs/prd/factory-pilot-release.md`) · One ticket = one branch = one PR.

## Why

The pilot is done when one real piece of factory work on ARCA has gone all the way through: built
by the factory, signed off on its Review screen by ARCA's founder, and approved by John.

## What to do

Signed in as `arca.founder@bruntsfield.capital` (FB-090), which is in no admin list and sees ARCA
only. John holds it. ARCA needs:

- **its lane kept paused** (FB-264), so the factory is the only engine on ARCA;
- **working preview environments.** These work: every ARCA pull request since 8 October has had
  its own environment (FB-230, closed 28 October). The Review screen takes its preview link from
  there;
- **the factory installed:** a `factory/` folder, `MISSION.md` and `harness/` (it already has a
  `## Checks` list);
- **in cowgate (CG-0067):** a budget for ARCA's issues, and `factory-main-watch` watching ARCA's
  `master` branch;
- **the factory's GitHub App** installed on ARCA's repository, if it isn't already;
- **one small first issue,** chosen by John.

## Done when

- [ ] The first issue's card showed the same state on Telegram and in the studio throughout.
- [ ] ARCA's founder signed it off on its Review screen, and John approved it.
- [ ] John has clicked through staging as himself and as ARCA's founder.

## Out of scope

THE RESET (FB-010). Retiring ARCA's lane for good (FB-268).
