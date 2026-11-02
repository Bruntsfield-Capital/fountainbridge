# Deploying the Foundry Studio (FB-009)

Host: **Railway** (D6, amended 2026-07-21 from Vercel — the studio's in-memory read-caches want a
long-running server, and ventures already run on Hetzner VPS). Data: **Supabase** (used as Postgres
from Phase 2 on; the read-only studio needs none yet). Auth: **Google OAuth**.

> The code + config in this PR is complete. **The live deploy needs your accounts/credentials** —
> the steps below are [MANUAL]. Nothing is provisioned by the lane.

## 1. Railway service

`railway.json` (in the repo root) configures a NIXPACKS build, `npm run start`, a healthcheck at
`/api/health` (100-second timeout), and a restart-on-failure policy with 3 retries. Railway stops
reading `railway.json` on **2026-12-01**; `.railway/railway.ts` holds the same settings for after that
(FB-229, below). On Railway:

1. New Project → Deploy from the `wealthcx01/fountainbridge` GitHub repo (branch `main` after the
   stack merges).
2. Railway auto-detects Next.js: builds `npm run build`, starts `npm run start`, injects `PORT`
   (Next respects it). Healthcheck `/api/health` returns `{"status":"ok"}` and is public (excluded
   from the auth middleware).
3. Add the environment variables below.

### Moving from `railway.json` to `.railway/railway.ts` (FB-229)

**What changed.** Railway is retiring `railway.json` ("config as code") on 2026-12-01 in favour of
`.railway/railway.ts` ("infrastructure as code"). The new file is in the repo and carries the same
five settings. `lib/railway-config.test.ts` fails the build if any of them is lost or changed, and
also if the two files disagree while both exist.

**The one thing to understand.** Railway reads `railway.json` every time it deploys. It never reads
`.railway/railway.ts` on its own. The new file only does anything when a person runs
`railway config apply`, once per environment. Merging it changes nothing on Railway.

**What `railway config migrate` got wrong.** Its draft dropped the builder and the restart policy. It
also left out the GitHub source and the variables, and Railway treats anything left out as "delete
it": applied to staging, that draft would have deleted all eight variables (the sign-in keys among
them) and disconnected the service from GitHub. The file in the repo was written by hand to avoid all
of that. Do not regenerate it with `migrate`.

**Who applies it: John, and only John.** Running `railway config apply` is a deploy. It changes how
Railway builds, starts and restarts the studio, so it is an external action under non-negotiable 4,
not a code change. A lane agent, a review pass, or anyone else following this page must stop here and
ask John. Do not run `apply` because a plan came back clean, because CI is green, or because this
pull request merged. John applies to **staging first**, watches that deploy go green, and only then
applies to **production**. The approval for each environment is recorded before that environment is
applied.

Anyone may run steps 1 and 2 (`link` and `plan`): they only read. Step 3 onwards is John's.

**Steps, in order. Staging first, then production, never in the same sitting as another deploy change.**

1. `railway link -p foundry-studio -e staging -s foundry-studio` (this only changes which environment
   your own terminal points at).
2. `railway config plan --verbose`. Read every line. It must say **0 to destroy**. The only changes it
   should show are the five settings moving in. If it lists any variable to delete, add that name to
   the `env` list in `.railway/railway.ts` as `preserve()` and plan again. Do not apply a plan that
   destroys anything.
3. **John only, with the approval recorded:** `railway config apply`. Then watch the next staging deploy: it must go green, and the deploy's
   settings in the Railway console must show the health check at `/api/health`.
4. Only after staging has deployed green from the new file: John repeats steps 1 to 3 with
   `-e production`, again with its own recorded approval. Plan against production itself first; a
   clean plan on staging or on a preview does not count.
5. Only then delete `railway.json`, in its own pull request.

**From then on:** any new variable set on Railway must also be added to the `env` list in
`.railway/railway.ts` as `preserve()`. Otherwise the next `apply` deletes it.

The `railway` command evaluates the file with the `railway` npm package, which this repo does not
install. To run `plan`, install it somewhere outside the repo and link it in as
`.railway/node_modules` for the duration (that folder is ignored by git). The CLI also checks its own
version by running `$_ --version`, so call `railway` directly, not through `timeout` or another
wrapper, or it reports a false "CLI too old" error.

## 2. Environment variables (Railway → Variables)

| Var | Value |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` (set in code too; harmless) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from the Google OAuth client (step 4) |
| `STUDIO_ADMIN_EMAILS` | `john.gallagher@wealthcx.com` (comma-separated for more admins) |
| `GITHUB_TOKEN` | **PAT path (v0):** org-scoped read PAT so lanes/tickets/PRs render. Takes precedence over the App vars below if both are set. |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID` | **GitHub App path (production, FB-020):** set all three (and leave `GITHUB_TOKEN` unset) to have the studio mint short-lived installation tokens from the App key. The private key is the App's `.pem`; escaped `\n` in the env value is normalised automatically. |
| `GITHUB_ORG` | `wealthcx01` (default; set if different) |
| `FOUNDRY_APPROVAL_SECRET` | **FB-046/044 external-action gate:** the HMAC secret the studio uses to sign approval grants **and to verify them on read**. Absent, the studio cannot check any approval: every approval card renders a warning saying so, and (because the executor may still hold a working secret) an approved action can still go out. Must be **identical** to the value on each venture's gated executor, and must **never** be set on a lane box. `openssl rand -hex 32`. |
| `STUDIO_APPROVAL_GITHUB_TOKEN` | **FB-046:** a write-scoped token for the venture's `foundry-approvals` ref (the read App/PAT stays read-only). Absent → the Approve button reports "approvals not set up yet". |
| `FACTORY_DOOR_SECRET` | **FB-275:** the key the factory's planning box signs its cards with. Absent, the door answers `404` to everything. `docs/factory-cards.md` has the detail. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | **FB-141:** the keys for phone notifications. Absent, the studio sends no notifications. |
| `STUDIO_PUBLIC_URL` | the studio's own https address. The links in a founder's emails start with it (`AUTH_URL` is used if it is missing). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | **FB-279, production only:** the Google Workspace email settings, so a founder whose phone did not take a notification gets an email instead. Absent, no email is sent and the log says so. Staging must never have them. |

Use **one** of the two GitHub auth paths: a `GITHUB_TOKEN` PAT, or the three `GITHUB_APP_*` vars.
App installation tokens expire hourly, so a GitHub App must go through the `GITHUB_APP_*` path (a
raw App token pasted into `GITHUB_TOKEN` would stop working after ~1 hour) — see FB-020.

Do **not** set `E2E_TEST_LOGIN`, `*_FIXTURE_DIR`, or `E2E_TEST_LOGIN_SECRET` in production — those
are test-only seams and the app treats them as such.

### Staging's own database, and every preview's (FB-282)

Staging has its own Postgres, in its own environment, holding test data only. Production's database
(Supabase) is never touched by any of this.

**Before each deploy, Railway runs `node scripts/apply-schema.mjs`** (first in `npm run
before-deploy`, the pre-deploy command in `railway.json` and `.railway/railway.ts`). It runs inside Railway's private network, so the database
never needs a public address. It loads every `db/*.sql` file the database hasn't had yet, in name
order, records each in a table called `schema_files`, and gives the `foundry_studio` role a sign-in
with the password in `STUDIO_DB_PASSWORD`. A schema change is always a new file: a file that changed
after it was loaded is reported and never run again. If loading fails, the deploy stops and the old
one keeps running.

**It does nothing unless `SCHEMA_ADMIN_URL` is set,** and it refuses any database that is not on
Railway's private network (`*.railway.internal`). Production doesn't set it, and its database is on
Supabase, so production is skipped twice over.

**Staging's three variables** (in the `foundry-studio` service, staging environment). Railway fills in
the parts in `${{ }}` from the Postgres service, so no address or password is typed anywhere:

| Variable | Value |
|---|---|
| `STUDIO_DB_PASSWORD` | a long random value, made in Railway's variable editor; never written down elsewhere |
| `SCHEMA_ADMIN_URL` | `${{Postgres.DATABASE_URL}}` (the database's owner, used only to load the schema) |
| `DATABASE_URL` | `postgresql://foundry_studio:${{STUDIO_DB_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}` |

The studio signs in as `foundry_studio`, never as the owner: row-level security binds that role,
and the owner would read straight past it (FB-170).

**Previews copy staging** (John, 28 October 2026), never production. Each preview gets its own copy of
staging's Postgres, and these same variables point at it, so the pre-deploy step loads the schema
into the preview's own empty database too.

### Production's SQL runs first (FB-287)

Production's database (Supabase) is the one place the schema is run by hand. On 1 November 2026 a
pull request was merged, and deployed, before its SQL had run there, and for five minutes the studio
could not record a press. Two locks stop that now.

**1. A pull request that changes `db/` cannot merge until John has run its SQL.** The check
"Production SQL" (`.github/workflows/production-sql.yml`) fails on any pull request that adds,
changes or removes a file in `db/`, and names the files. John runs them on production, then adds
the label `production-sql-run`, and the check passes.

- Only John's label counts. If anyone else (the factory's GitHub App, say) was the last to add it,
  the check fails.
- A later push that changes the pull request's `db/` files takes the label off, and the check fails
  until John adds it again. A push that changes other files, or brings the branch up to date with
  `main`, leaves it on.
- The check is taken from `main`, never from the pull request, so a pull request cannot change the
  rules it is checked by. A pull request that doesn't touch `db/` passes at once.
- It is a required check on `main`, beside Lint, Typecheck, Test and the Playwright UI gate.

**2. Production refuses to deploy code whose schema isn't there.** Before each deploy, Railway runs
`npm run before-deploy`: first `apply-schema.mjs` (above), then `scripts/schema-ready.mjs`. That
signs in with the studio's own `DATABASE_URL` and reads `foundry_meta.schema_files`, the list of
schema files the database has had run. If a `db/*.sql` file in the new code isn't on it, it names the
file and stops, and Railway keeps the old version running. It reads only, and prints file names.

- Every schema file records itself on that list, so running the file is what puts it there.
  `db/012_schema_record.sql` made the list and recorded 001 to 012. Every later file ends with its
  own line:

  ```sql
  insert into foundry_meta.schema_files (name) values ('013_example.sql') on conflict (name) do nothing;
  ```

  `scripts/__tests__/schema-ready.test.mjs` fails for a file without it.
- On staging and previews, `apply-schema.mjs` runs the files just before, so the check passes there
  on its own.

**To ship a pull request with a schema file:** run the file on production in Supabase's SQL editor,
whole, then add the label. Merge after the check is green.

### Onboarding a venture repo (so its board isn't empty) — FB-021

A venture board reads tickets from `docs/tickets/` on the repo's **default branch**, via the GitHub
auth above. For a board to populate, the repo must be onboarded on **both** axes — access *and* content:

1. **Access** — the studio's credential must be able to *read* the repo:
   - **GitHub App path:** install the Foundry GitHub App **on that specific repository** (or the whole
     account) with **`Contents: read`** + **`Metadata: read`** permissions. A private repo the App
     isn't installed on returns HTTP 404 — indistinguishable from a missing repo — so an install/scope
     gap looks like "not found". Installing the App is a **human action** (GitHub → the App →
     *Install / Configure* → select the repos); it cannot be done from this lane.
   - **PAT path:** the `GITHUB_TOKEN` PAT must be scoped to read the repo.
2. **Content** — the ticket backlog must live under `docs/tickets/` on the **default branch**
   (`main`/`master`). Tickets on a side branch won't show; the default branch is the contract (D2).

**Repos to onboard now:** `wealthcx01/arca` (default `master`), `wealthcx01/thereset-platform`,
`wealthcx01/thereset-marketing`.

How the board reports each state (so a founder can tell "not set up yet" from "broken"):

| Studio shows | Meaning | Fix |
|---|---|---|
| "isn't connected to GitHub yet" | No `GITHUB_TOKEN`/`GITHUB_APP_*` configured at all | Set the auth vars above |
| "Can't read <repo> … credentials don't have read access" | Auth set, but no access to this repo — App not installed, or App/PAT lacks `contents: read` (both a missing repo and a 403 "not accessible by integration" land here) | Install/scope the App on the repo, or scope the PAT |
| "No tickets on the default branch (`<ref>`)" | Reachable, but backlog not on the default branch | Merge the backlog to the default branch (e.g. FB-030 for arca) |

## 3. Domain (Holy Corner vertical-login pattern)

Point a subdomain at the Railway service — e.g. **`foundry.<main-domain>`**, consistent with how
grassmarket's login site is exposed. Agree the exact subdomain, add it as a Railway custom domain,
and let Railway issue HTTPS.

## 4. Google OAuth client

Google Cloud Console → Credentials → OAuth 2.0 Client (Web):

- **Authorized redirect URI:** `https://foundry.<main-domain>/api/auth/callback/google`
- Copy the client ID + secret into the Railway vars above.
- Scopes: default (email/profile) — the studio only needs the signed-in email for scoping.

## 5. Uptime monitor

The pane of glass must not die silently. Point an external monitor (UptimeRobot, Better Uptime,
Railway's own healthcheck, or a cron ping) at `https://foundry.<main-domain>/api/health` — expect
HTTP 200 + `{"status":"ok"}`. Alert to wherever John watches.

## 6. Phase-1 exit test (FB-010 gate)

Once live: run one full working morning of the **ARCA** venture through the studio **from a phone
only** (390×844 verified in the CI mobile UI-gate). Log every gap as a ticket — that evidence is
what FB-010's retro turns into the Phase-2 backlog.

## Preview environments (the Vercel feature we traded away)

Railway supports **PR environments** — enable them so each PR gets an ephemeral URL, restoring the
"founder clicks a link and sees the change" power path (parity §3) that FB-007's attention queue
surfaces via `previewUrl`. Configure under the Railway project's environments settings.
