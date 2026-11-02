# CLAUDE.md — fountainbridge (Foundry Studio)

Fountainbridge is the **Foundry Studio** — Bruntsfield Capital's founder-facing platform for launching and running co-created ventures (a Cofounder-class founder dashboard on our own substrate). It is one vertical of **Holy Corner** (the Bruntsfield hub); **grassmarket** (Advisory Studio) is the sibling that already consumes the shared contracts. Ventures are **configured, never hard-coded**: everything venture-specific lives in `ventures/*.yaml` manifests validated against **bcap-contracts** (Pydantic v2 + JSON Schema → generated TS types). Git is the source of truth for work items — the studio is a view + write-path over `docs/tickets/` via the GitHub API, not a separate database of record.

Launch venture: **the-reset** (B2C) — **parked** since 2026-10-07 until ARCA runs cleanly on the new setup; it then starts fresh on the new system (FB-010, D5 amendment). Test bed: **arca**. Parity target (John): at least at par with cofounder.co, preferably better — the substrate is ahead, and the phased plan closes the founder-experience gap.

## Normative documents (read before any studio work)

- `docs/fountainbridge-phased-plan.md` — v4. **Decisions D1–D8 are binding** until amended by PR. Phases 0–5.
- `docs/parity-critique.md` — honest scorecard vs Cofounder; what "behind" means and where it is fixed.
- `docs/research-gtm.md` — FB-012, **ratified**. The GTM architecture (interest-based sends, venture Workspace domains, ActiveGraph gate). Governs all of Phase 4b.
- `docs/cofounder-reference-index.md` — the competitive baseline, fully scraped.
- `docs/tickets/` — FB-001 onward. One ticket = one branch = one PR.
- `MISSION.md` and `docs/prd/factory-pilot-release.md` — the release being built now: the factory
  pilot (FB-271 to FB-280). `harness/END-TO-END.md` holds its journeys.

Where the plan and a ticket disagree, the ticket's **scope** section wins for what ships in that PR; the plan wins on intent. Decisions change only by PR to the plan.

## Non-negotiables

1. **One ticket = one branch = one PR.** Tickets are markdown in `docs/tickets/` (`FB-XXX-slug.md`); branch names are `fb-XXX-slug`. Work only the ticket on the branch.
2. **Only John's yes merges.** A pull request merges only after John has approved it: in GitHub, or
   with his Approve in the studio. That includes a founder's own venture's work. Green checks and a
   passed `/review` come first, but they are what makes a pull request ready to ask about. They are
   not the yes.
   - **A founder's Accept is their sign-off, and merges nothing.** When a founder accepts a piece of
     their venture's work in the studio, the studio writes "Signed off by <founder>, waiting for
     John" on the pull request, and the work waits for John. `acceptWork` in `app/actions/work.ts`
     merges only for an address in `STUDIO_ADMIN_EMAILS`, and
     `app/actions/__tests__/work.test.ts` proves a founder's Accept merges nothing.
   - **John merges every pull request to this repository, in GitHub.** No lane, agent or workflow
     merges its own pull request, or anyone else's.
   - **Before John is asked:** CI is green — lint, typecheck, test, and the Playwright UI gate — and
     `/review` has passed.
   - **Merging is not an external action.** Approving a pull request never approves an email, a post,
     a payment or a deploy. Those still need their own recorded approval (non-negotiable 4).

   GitHub does not enforce John's yes on its own. `main` is branch-protected (a pull request and
   passing CI are required), but "required approvals" stays at 0, because GitHub will not let John
   approve his own pull request. So the rule holds because nothing automated is allowed to merge:
   Archon's house workflow has no merge step and the Claude inside it holds no GitHub credentials,
   the studio's own lane only opens pull requests, and the studio merges only on John's Approve.

   *(Amended 2026-10-28, FB-272, as John settled for the factory pilot on 26 October
   (`docs/prd/factory-pilot-release.md`): only John's Approve merges, and a founder's Accept is their
   sign-off. This replaces the wording of 2026-10-07, which let a founder's approval in the studio
   merge their venture's work. Kept from 2026-08-28: the **Playwright UI gate is a required check.**
   It was advisory, and a red one merged itself — FB-124 shipped a studio with two navigations and a
   250px rail on a 393px phone while every other check was green. It is the only gate that sees a
   screen.)*
3. **Respect ticket scope.** Discovered work becomes a new ticket file in the PR or a follow-up — never scope creep into the current PR.
4. **Gates are absolute.** Engineering changes gate on PR review; external actions (email, social, CRM, payments) gate on **ActiveGraph** approval events. Nothing external ever executes without a recorded human approval (`approval.proposed` → `approval.granted`).
   *(One exemption, John, 2 November 2026 (FB-289): a founder's own notices about their own
   venture's work, sent only to that founder's own sign-in address and their own phone, need no
   recorded approval. Nothing else is exempt: not a message to anyone else, not one about another
   venture, and not one sent anywhere but the founder's own sign-in address or phone.)*
5. **Venture-as-config.** Nothing venture-specific lives in the studio core. A venture is a manifest; the studio must stay generic enough that a B2B motion (bank-sponsored wealth product) is "just another manifest."
6. **Venture isolation is server-side.** One VPS per venture (D1); a venture-scoped session must **never** fetch another venture's data — enforced server-side, never in the UI.
7. **Contracts through bcap-contracts.** Every rendered entity (Venture, Lane, Ticket, Approval, Department, RunReport) is a bcap-contracts type. Schema changes happen there (FB-002), consumed here as generated TS types. Schemas win on conflict.
8. **No secrets in the repo.** Venture secrets live on the venture's box / deployment env — never in this repo, tickets, or gbrain. No credentials in code.
9. **Built with gstack; gates never bypassed.** `/plan-ceo-review` before large/ambiguous work, `/review` (staff-engineer audit) + `/qa` before every PR, `/ship` to finalize, `/retro` at phase close-outs. No `--no-verify`.
10. **Fail loud, surface everything.** A founder blocked at 22:00 must see *why* in the studio — run reports, lane staleness, and failure states are surfaced in plain language, never swallowed.
11. **Look at the screen, beside its design, before the PR.** Any change that touches a screen is not
    verified until that screen and the design have been rendered **side by side in a browser**, at
    1440×1000 and 393×851, and both have been *looked at* — as pictures, not as markup. Record each
    page's height in the PR.

    **The design is the Claude Design artifact:**
    `https://claude.ai/code/artifact/7187a06f-f746-4e70-bfc6-446a3d7330ac`. It is a working
    prototype, not a picture: open it with Playwright, press "Continue with Google" (either door
    signs you in), and click the rail's labels — Tickets, What happened, Memory, Handbook, The pocket
    studio — to reach each screen. Screenshot both sides and **read the images**.

    **The live side is production**, signed in as the venture's founder, because fixtures are small
    and every fault this rule exists to catch only appears at real size: ARCA's 73 tickets, its 1,773
    run reports, its five weeks of history.

    `docs/design-conformance.md` is the scorecard, with the method written out and the last reading
    for every screen. Add a line to it.

    This is a gate because its absence has cost more than any other failure here. Thirty tickets
    shipped, each verified against its own scope, and nobody compared a screen to the design until
    John asked twice — by which point the desk was **9,908px against a design of ~1,900**, half of it
    a board of finished tickets, and "What happened" was printing the same sentence twenty times.
    Every automated gate was green throughout: the sections were all present, in the right order,
    with correct data (`desk.spec.ts` asserts exactly that and passes either way). A screen can be
    entirely correct and completely unusable, and only a person looking at it sees that.

    A screen that has never been compared to its design has not been verified. Say so in the PR
    rather than implying it has.

12. **Write for the founder: simple, clear, detailed, direct English.** This binds tickets, PR
    bodies, commit messages, code comments, and every word rendered in the studio — on this repo and
    on every venture box.

    A founder reads these. Some are not technical, and none of them should need to be. So: short
    sentences. The plain word over the clever one. Say what happened, then what it means, then what
    to do. Name the thing rather than gesturing at it. Detailed is not the opposite of simple — a
    founder needs the specifics, they just need them in words they already know.

    What this forbids: unexplained jargon; a table where a sentence would do; density that saves the
    writer's time at the reader's expense; and burying the answer at the end. `copy-lint` catches the
    founder-vocabulary rules it can check mechanically (FB-103's "team" not "agent"); this covers
    everything it cannot.

    **This applies to the reply itself, not only to what is written into files.** The last message of
    every turn must stand on its own: what was done, what it means, what is left, and what the reader
    has to decide — in full, in that order, without needing the messages above it. A reply that
    assumes the reader remembers three turns of context is the same failure as a ticket that assumes
    the founder reads code.

## Stack (Decision D6)

- **App:** Next.js (App Router) + TypeScript, mirroring Cofounder's managed stack so venture apps and the studio feel identical to operate. It arrived in FB-005 and is live: production and staging run on Railway (addresses in `MISSION.md`).
- **Hosting / data:** **Railway** + Supabase. Deploy config lands in FB-009. *(D6 amended 2026-07-21, PR FB-009: Vercel → Railway — the studio's in-memory read-caches want a long-running server, and ventures already run on Hetzner VPS, D1. See the phased plan's D6 note.)*
- **Auth:** **Google OAuth** (the Holy Corner vertical-login pattern). Venture scoping keys off `founder.workspace_email` in the manifest — a Bruntsfield-assigned Google Workspace account on the shared `@bruntsfield.capital` domain until spin-out (e.g. `arca.founder@bruntsfield.capital`; D3 amended 2026-07-22), **never** a personal `@gmail.com`. John's account → all ventures; a founder's account → their venture only.
- **Contracts:** `bcap-contracts` (Pydantic v2 + JSON Schema → TS), the same package grassmarket consumes.
- **Source of truth:** GitHub API over the venture repos' `docs/tickets/` — no separate DB of record.
- **Branding:** grassmarket / main Bruntsfield site design tokens — **do not invent a theme**; pull the existing tokens.
- **CI:** lint + typecheck + test, plus the Playwright UI gate (screenshot gallery per PR) — mirroring the portfolio-wide CI pattern.
- **The factory:** the software factory builds and checks the studio as it does the website
  (FB-272). Its files are `factory/` and `harness/`; it starts a **test copy** for each run with
  `node scripts/test-copy.mjs start --port <port>`, which has its own throwaway database on the
  planning box and is deleted after the run. README, "Running it for the factory", has the detail.

## Checks

The commands the factory's house workflow (`bruntsfield-ticket`) runs, in this order,
from the repo root, before anything is pushed. One command per line. Keep this list
true: the workflow runs exactly these and never guesses.

```bash
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm test
make validate-manifests
make parse-tickets
AUTH_SECRET=build-time-placeholder-not-a-real-secret AUTH_TRUST_HOST=true npm run build
make activegraph-test
FB171_REQUIRE_ACTIVEGRAPH=1 npx vitest run deploy/executor/__tests__/executor-activegraph.e2e.test.mjs
make design-lint
make copy-lint
make ticket-drift
CI=1 npm run test:e2e
CI=1 npm run test:e2e:degraded
CI=1 npm run test:e2e:scale
```

The Playwright UI gate runs on the planning box now: Chromium works there, and on 28 October 2026
(FB-272) every spec passed locally. `CI=1` makes Playwright start its own server and fail if
something already holds port 3100, rather than quietly testing whatever is running there.

Left out: `make provision-lint`, because shellcheck is not installed on the planning box. CI still
runs it. The build line uses the same throwaway `AUTH_SECRET` as CI.

## Architecture spine

- **Git is the source of truth for work items.** The studio renders `docs/tickets/` from venture repos via the GitHub API. The dashboard is a view + write-path onto git, never a competing store.
- **Contracts through bcap-contracts** for every rendered entity. See non-negotiable 7.
- **Venture isolation** is physical (one VPS per venture, D1) and enforced server-side (non-negotiable 6).
- **Governance (D7):** each manifest carries an approval matrix — founder approves product-visible changes, Bruntsfield approves platform/infra/security, **dual-approve** for high-blast-radius (migrations, auth, payments, secrets, external sends). The attention queue routes each item to the right approver(s). For a pull request, a founder's approval is their sign-off and only John's merges (rule 2).
- **Context & library (D8):** `context/` (durable background, department-tagged) and `library/` (artifacts/outputs) live in the *venture* repo; heavy binaries in object storage with pointers. gbrain indexes git.

## Layout

```
fountainbridge/
├── CLAUDE.md                 # this file — the non-negotiables
├── MISSION.md                # what the studio is, and the pilot being built now
├── README.md                 # read order, running it, running it for the factory
├── app/ components/ lib/     # the Next.js studio
├── db/                       # the database, in order: 001_…sql onward (FB-170)
├── e2e/                      # Playwright UI gate, its fixtures, and the test settings (server-env.mjs)
├── scripts/                  # tools, including the test copy (test-copy.mjs)
├── ventures/                 # one YAML per venture (FB-003): the-reset, arca, modernisation-engine, example
├── harness/                  # the factory's journeys (END-TO-END.md) and settings — protected
├── factory/                  # the factory's installed files, as on the website — protected
├── docs/
│   ├── fountainbridge-phased-plan.md   # v4, D1–D8 (normative)
│   ├── prd/                            # release PRDs — protected
│   └── tickets/                        # FB-XXX-slug.md
└── .github/workflows/ci.yml  # CI: lint, typecheck, test, build, the Playwright UI gate and more
```

## Build sequence (phases — see the phased plan)

The plan's original order, kept for its reasoning. What is being built now is the factory pilot
(see "Current state" below).

0. **Foundations.** Repo scaffold + CI + branch protection (FB-001), bcap-contracts entities (FB-002, in that repo's lane), venture manifest format + the-reset/arca manifests (FB-003), VPS provisioning runbook→script (FB-011), GTM research (FB-012, ratified).
1. **Studio v0 (read-only).** Next.js shell + Google OAuth venture-scoped (FB-005), ticket parser (FB-004), lanes/tickets view (FB-006), attention queue of open PRs (FB-007), CI/activity (FB-008), mobile + Railway deploy (FB-009), dogfood week + retro → Phase 2 set (FB-010).
2. **Write path + per-venture scheduler.** Create/edit tickets from the studio; systemd timers waking lanes, RunReports written back. Scoped by FB-010's retro.
3. **Founder experience.** Conversational composer, in-studio approvals, nothing-fails-silently, D8 context/library.
4. **GTM departments.** 4a content/site (PR-gated, no research dependency); 4b interest-based sends (`docs/research-gtm.md` §7, ActiveGraph-gated).
5. **Public + repeatable.** Foundry landing page in Holy Corner; provisioning matures to venture-in-a-day; generic-tenancy hardening for the B2B posture.

**Dependency order:** FB-001 ∥ FB-002 → FB-003 → FB-004 ∥ FB-005 ∥ FB-011 → FB-006 → FB-007 ∥ FB-008 → FB-009 → FB-010. FB-012 ratified; Phase 4b tickets (FB-02x) drafted from the research doc §7.

## Memory

gbrain is wired for this lane; record decisions and cross-session context there, partitioned per venture where venture-specific. The lane-opening note (`fountainbridge-lane-opening`) holds purpose, D1–D8, ventures, and the dependency order.

## GBrain Search Guidance (configured by /sync-gbrain)
<!-- gstack-gbrain-search-guidance:start -->

gbrain is the searchable memory of this repo. Prefer it over Grep when the question is about meaning
("where is X handled?") and you do not yet know the exact word to search for. Grep is still right when
you know the exact string, need a regex, or want a file glob.

**What is indexed.** One source, `fountainbridge`, holding 682 pages: **415 code pages** (every
tracked `.ts`/`.tsx`/`.mjs`/`.sh` file, chunked by symbol) and **267 notes** (`docs/tickets/`,
`docs/`, `context/`). It is pinned by the `.gbrain-source` file in the repo root, so every `gbrain`
command run from anywhere under this worktree routes here with no `--source` flag. It is federated, so
searches from other repos on this box can reach it too.

**Commands, and what each is for:**

- `gbrain search "<terms>"` — keyword search over code and tickets together.
- `gbrain query "<question>"` — hybrid search; use it for a real question.
- `gbrain code-def <symbol>` — where a symbol is defined. Returns file, line range and the snippet.
- `gbrain code-refs <symbol>` — every reference to it.
- `gbrain code-callers <symbol>` / `gbrain code-callees <symbol>` — the call graph, symbol to symbol.
  Callers are the *functions* that call it, not the raw line count, and test files are excluded. When
  you need every call site including tests, use Grep.

**The pack trap — read this before trusting a zero.** Symbol lookup only works when the active gbrain
schema pack declares a `code` page type **with `extractable: true`**. The bundled packs do not:
`gbrain-base-v2` dropped the `code` type entirely, and `gbrain-base` declares it
`extractable: false`. Under either one, `code-def` returns `count: 0` and a dream cycle reports success
while resolving nothing. This box therefore runs a local fork, `bcap-engineer`
(`~/.gbrain/schema-packs/bcap-engineer/pack.json`), which declares `code` extractable. Check it with:

```
gbrain schema active          # expect: bcap-engineer
gbrain schema explain code    # expect: extractable: true
```

**If a code query returns nothing,** the cause is almost always one of three things, in this order:

1. The active pack is not `bcap-engineer` — a `gbrain self-upgrade` or a `gbrain schema use` can reset
   it. Fix: `gbrain schema use bcap-engineer`.
2. The code pages were never imported. A plain `gbrain sources add --path` does a **markdown-only**
   walk, and `gbrain sync` without `--strategy code` never looks at a `.ts` file. Fix:
   `gbrain sync --strategy code --source fountainbridge --full` (about 3 minutes, 415 files).
   `--full` matters: the incremental path reports "0 changed, 1 unchanged" and does nothing.
3. The call graph was never built. `resolve_symbol_edges` is a **global-scope** phase, so
   `gbrain dream --source fountainbridge` silently skips it. Fix:
   `gbrain dream --phase resolve_symbol_edges --once`.

Do not run `/sync-gbrain` while `gbrain autopilot` is active (autopilot is not installed on this box).
Note that `/sync-gbrain`'s own orchestrator does not fix any of the three faults above: it reports
`OK synced fountainbridge` on a no-op incremental pass.

<!-- gstack-gbrain-search-guidance:end -->

## Current state

The studio is live on Railway, with ARCA as its test bed. The release being built now is the
**factory pilot** (`MISSION.md`, `docs/prd/factory-pilot-release.md`): the studio's tickets FB-271
to FB-280, one at a time, each from `main` after the last has merged. FB-272 made the studio ready
for the factory: the test copy, `/build-id`, `harness/runtime.inputs.json`, and rule 2 above.

**Factory log:** when you start a ticket, open its PR, or come back after a crash, run `factory-log firm ticket.started|pr.opened|lane.recovered fountainbridge <ticket-id> [note]` (e.g. `factory-log firm ticket.started fountainbridge FB-270`); the manual is OPS.md in wealthcx01/cowgate.
