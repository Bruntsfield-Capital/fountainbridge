# fountainbridge — Foundry Studio

The **Foundry Studio**: the vertical of Holy Corner through which Bruntsfield Capital's Foundry ventures are launched and run. A Cofounder-class founder dashboard on Bruntsfield's own substrate — the workshop (Claude Code lanes on per-venture VPSes), gstack roles, gbrain memory, tickets-as-git, PR + ActiveGraph approval gates.

**Parity target:** at least at par with cofounder.co, preferably better. Where we're structurally ahead: founders co-own their repos, VPS, and infrastructure from day one (SSH included) — no "graduation," no rented stack, stricter production defaults, and a human partner in the loop.

## Holy Corner map

| Vertical | Studio | Codename |
|---|---|---|
| Advisory | Advisory Studio | grassmarket |
| **Foundry** | **Foundry Studio** | **fountainbridge (this repo)** |
| Briefing | Briefing Studio | TBD |
| Equity | Equity Studio | TBD |

**Launch venture:** THE RESET — parked since 7 October 2026 until ARCA runs cleanly on the new setup, then started fresh on the new system (FB-010). **Test bed:** ARCA.

## Read first

1. `docs/fountainbridge-phased-plan.md` — decisions D1–D8, Phases 0–5 (v4)
2. `docs/cofounder-reference-index.md` — the competitive baseline, fully scraped
3. `docs/parity-critique.md` — honest scorecard vs Cofounder
4. `docs/research-gtm.md` — verified GTM findings + ratified architecture
5. `docs/tickets/` — FB-001 onward, one ticket = one branch = one PR
6. `MISSION.md` and `docs/prd/factory-pilot-release.md` — what is being built now (the factory pilot)

## Running it locally

Node 22 (what CI uses). From a fresh clone or an out-of-date one:

```bash
git checkout main && git pull        # start from what actually shipped
npm ci                               # not `npm install` — the lockfile is the contract
cp .env.example .env.local           # then fill it in; no secrets live in this repo
npm run dev                          # http://localhost:3000
```

Before opening a PR, run what CI runs — `npm run lint`, `npm run typecheck`, `npm test`. The
browser suite (`npm run test:e2e`) needs `npx playwright install chromium` once.

## Running it for the factory

The software factory builds and checks the studio the way it does the website. It starts a fresh
**test copy** for each run, signs in to it, and looks at it.

- **Build:** `npm ci`, then `npm run build`.
- **Start:** `node scripts/test-copy.mjs start --port <port>` (argv
  `["node","scripts/test-copy.mjs","start","--port","{port}"]`). It makes a throwaway Postgres
  database on this machine for the run, named `fb_test_<time>_<random>`, applies every `db/*.sql`
  file to it in order, and starts the built studio on `127.0.0.1` only. The studio reads the test
  fixtures instead of GitHub, has the test sign-in door on, and uses the same settings as
  Playwright's own server (`e2e/server-env.mjs`). It connects to the database as `foundry_studio`,
  so row-level security applies as it does in production.
- **Never a real database.** It refuses to start if `DATABASE_URL` is set to anything but a
  throwaway database on this machine. Never Supabase, never staging, never production. It also
  passes the studio only a short list of settings from your shell, so a real GitHub token there
  cannot reach it.
- **Stop:** Ctrl+C, or `node scripts/test-copy.mjs stop --state <folder>` (start prints the
  folder). Stopping drops the database. A copy that is killed outright cannot drop its own, so every
  start drops what earlier copies left behind, and `node scripts/test-copy.mjs sweep` does it on
  demand. `node scripts/test-copy.mjs list` shows them.
- **Health:** `GET /api/health` answers `{"status":"ok","service":"foundry-studio"}`.
- **Build identity:** `GET /build-id` answers `FACTORY_RUNTIME_CANDIDATE` when it is set,
  otherwise the Git commit.
- **Signing in:** at `/login`, type the address in the "Test email" box and press "Test sign in".
  ARCA's founder is `matthew@bruntsfield.capital`; John is `john.gallagher@wealthcx.com`.
- **Journeys:** `harness/END-TO-END.md`. Journeys 1 and 2 are `e2e/journeys.spec.ts`; run it
  against a running copy with `E2E_BASE_URL=http://127.0.0.1:<port> npx playwright test e2e/journeys.spec.ts`.
  Journeys 4 and 5 (the Review screen) are `e2e/review.spec.ts`; run it the same way, with
  `FACTORY_RUNTIME_STATE` set to the copy's state folder.
- **Presses:** each press on a factory card is kept in the press store, where the planning box
  collects it through its door (FB-276, `docs/factory-cards.md`), and never reaches GitHub. In a
  test copy each one is also written as one line to `presses.jsonl` in the state folder.
- **Tests:** the commands under `## Checks` in `CLAUDE.md`.

**What the machine needs.** The user that runs the test copy must be able to make databases on the
local Postgres (`CREATEDB`) and act as `foundry_studio` (be a member of that role). A superuser can
do both. The first run makes the `foundry_studio` role if it is missing, as `db/001_read_model.sql`
does in every environment. The factory's user may not connect to the `postgres` database, so the factory's settings set
`TEST_COPY_PG_ADMIN_DB=archon_factory`: the test copy connects there first to make and drop its
throwaway databases.

**The factory's runtime host** copies only the files it is told to, and refuses a copy that holds a
`node_modules` folder. So its setup installs the packages one folder above the copy (Node looks
there too) and builds inside it. The host's own settings are operator files outside this
repository, as for the website. Its copy needs at least `app`, `components`, `lib`, `db`, `e2e`,
`scripts`, `tools`, `ventures`, `content`, `docs`, `library`, `public`, `schema`, `deploy`, and the
root config files (`package.json`, `package-lock.json`, `tsconfig.json`, `next.config.mjs`,
`next-env.d.ts`, `middleware.ts`, `auth.ts`, `auth.config.ts`, `.eslintrc.json`). The host ends a run
by killing the copy, so its teardown should be followed by `node scripts/test-copy.mjs sweep`.

### Running against the real deployment

A local `.env.local` proves the code works. It does **not** prove the deployment works — that
distinction cost weeks of a broken composer (FB-087). To exercise the studio with the deployed
environment, without copying secrets onto disk:

```bash
railway run --service foundry-studio npm start
```

Signed in as an admin, `/api/readiness?probe=1` then reports, per venture, whether the studio can
actually reach that venture's box.

## Conventions

Tickets live in `docs/tickets/`; one ticket = one branch = one PR; only John's yes merges — in GitHub, or with his Approve in the studio — after CI is green and `/review` has passed. A founder's Accept in the studio is their sign-off, and merges nothing (external actions still need their own recorded approval). gstack provides roles (/plan-ceo-review, /review, /qa, /ship, /retro); gbrain provides memory. Stack: Next.js + Railway + Supabase, Google OAuth, grassmarket-aligned branding. See `CLAUDE.md`.

**Dependency order:** FB-001 ∥ FB-002 (bcap-contracts) → FB-003 → FB-004 ∥ FB-005 ∥ FB-011 → FB-006 → FB-007 ∥ FB-008 → FB-009 → FB-010 (retro → Phase 2 set). FB-012 ratified — Phase 4b tickets (FB-02x) to be drafted from `docs/research-gtm.md` §7.

- `docs/architecture-replan-2026-09.md` — **PROPOSAL, awaiting John's ruling.** D10–D13 and an amendment to D1: Claude Code as the workbench, a Foundry MCP server that proposes and never grants, ephemeral per-ticket build environments, skills our agents load, and memory split into state and event. Read it before starting anything in Phase 3.

- `docs/design-gaps-open.md` — the open design questions, written so a section can go straight to Claude Design. Five today: what the desk becomes once work happens in Claude Code, what an empty office looks like, whether a figure means an agent, two tokens that do not exist, and the ledger on a phone.

- `docs/what-john-needs-to-do.md` — the four things waiting on John, each with exact steps, what it unblocks, and how he will know it worked. Read this before asking him for anything.
