# FB-287 — Production SQL first: no merge before it has run, no deploy before it is there

**Status:** Done · **Kind:** small · **Budget:** none (built in a Claude session, by hand) · **Phase:** 3 · **Raised by:** John, 1 November 2026 ("a pull request that needs production SQL must not be mergeable until I confirm the SQL has run, and production must refuse to deploy code whose schema isn't there yet, so the old version keeps running"), due before the ARCA rehearsal on 7 November 2026 · Issue #413 · One ticket = one branch = one PR.

## Why

On 1 November, #412 (FB-286) was merged before `db/011_follow_ups.sql` had run on production.
Railway deployed the new code at 18:00 UTC. Until John ran the SQL, the studio could not collect or
record a press on a factory card: the planning box's visits failed with HTTP 500, the last at
18:05:32. Nothing was lost, but a founder's press in that window would have been refused.

Production's database (Supabase) is kept by hand. Staging and previews load new `db/*.sql` files
by themselves before each deploy (FB-282), so only production has this gap.

## What was built

**Lock 1: the "Production SQL" check** (`.github/workflows/production-sql.yml`,
`scripts/production-sql-check.mjs`, its rules in `scripts/production-sql-lib.mjs`).

- A pull request that adds, changes or removes a file in `db/` fails until it carries the label
  `production-sql-run`. The check names the files. A pull request that doesn't touch `db/` passes.
- Only John's label counts (John, 1 November): if the last account to add it was anyone but
  `wealthcx01`, the check fails. The factory's GitHub App can add labels.
- A push that changes the pull request's `db/` files takes the label off (John, 1 November), and
  the check fails until John adds it again. A push that changes other files, or only brings `main`
  in, leaves it on. If the commit before a force push is gone, the label comes off, to be safe.
- Its own workflow, not a job in `ci.yml`: it also runs when a label is added or taken off, and
  `ci.yml` cancels its own runs on a new event. No path filter, so as a required check it never
  waits on a pull request that doesn't touch `db/`.
- The workflow runs `main`'s copy of the check, never the pull request's. This pull request is the
  one exception: `main` has no copy yet, so it uses its own.

**Lock 2: production won't deploy code whose schema isn't there** (`scripts/schema-ready.mjs`, its
rules in `scripts/schema-ready-lib.mjs`).

- `db/012_schema_record.sql` makes `foundry_meta.schema_files`, the list of schema files the
  database has had run, and records 001 to 012. The studio's role may read it and nothing more.
- From 013 on, each schema file ends by recording itself. A test fails for one that doesn't, and
  says which line to add.
- Railway's pre-deploy command is now `npm run before-deploy`: `apply-schema.mjs` (FB-282), then
  `schema-ready.mjs`. It signs in with the studio's `DATABASE_URL`, and stops the deploy, naming
  the missing files, if a `db/*.sql` file in the code isn't on the list. Railway keeps the old
  version running. It prints file names only.
- `railway.json`, `.railway/railway.ts` and `lib/railway-config.test.ts` carry the new command.
- `docs/deploy.md`: "Production's SQL runs first (FB-287)".

## Order (John's)

1. John runs `db/012_schema_record.sql` on production, whole, in Supabase's SQL editor.
2. John adds the label `production-sql-run` to this pull request. Its "Production SQL" check passes.
3. John merges. The next deploy's log on Railway says "The database has every schema file this
   version needs".
4. John makes "Production SQL" a required check on `main`.

## Done when

- [x] A pull request that adds a `db/` file fails "Production SQL" until John adds the label, then
  passes; one that doesn't touch `db/` passes (`scripts/__tests__/production-sql.test.mjs`).
- [x] A label added by anyone else does not count, nor one added again by someone else after John.
- [x] A push that changes the `db/` files takes the label off and the check fails until John adds it
  again; a push that changes other files, or brings `main` in, leaves it on.
- [x] `schema-ready.mjs` stops, naming the file, when the code has a schema file the database
  hasn't recorded, and passes when it has. Tested against a throwaway database on the planning box
  (`scripts/__tests__/schema-ready.test.mjs`).
- [x] Every `db/*.sql` file from 012 on records itself; the test fails for one that doesn't.
- [x] Each rule, taken out of the code, is caught by a test (nine rules, nine caught).
- [x] On production, after John runs `db/012`: the first deploy's pre-deploy step passes, and says so
  in Railway's log. It did on 2 November, at the second try (below): "The database has every schema
  file this version needs (13 recorded)", at 15:08:45 UTC.
- [x] John has made "Production SQL" a required check on `main` (2 November).
- [x] Every command in `CLAUDE.md` `## Checks` passes.

## What happened on production (1–2 November)

- **The check worked first time.** On #417 itself, "Production SQL" failed when the pull request
  opened (19:50 UTC, 1 November), and passed once John had added the label (19:55). John merged at
  19:57.
- **Staging passed.** It ran `db/012` by itself, and its log said "The database has every schema
  file this version needs (13 recorded)".
- **Production's first deploy stopped, and the old version kept running.** Its log said the
  database did not have any of 001 to 012. The list was there, and John had run `db/012`, but the
  studio's role read no rows from it.
- **The cause: row-level security, switched on by Supabase, with no rule.** Supabase switched
  row-level security on for `foundry_meta.schema_files` by itself when `db/012` made it. With it on
  and no rule (policy), the studio's role reads nothing, while John, signed in to Supabase as the
  table's owner, saw all 13 rows. Staging's Postgres doesn't do this, so the tests and staging
  passed.
- **The fix.** John added the rule by hand on production on 2 November:
  `create policy schema_files_studio_reads on foundry_meta.schema_files for select to foundry_studio using (true);`
  He redeployed, and the deploy passed (15:08:45 UTC). `db/013_schema_record_readable.sql`
  (FB-288) is the same rule, so every database matches, and a test now fails for any table that
  doesn't switch row-level security on and give its rule itself.
- **What it shows.** Lock 2 did its job on its first real day: production could not confirm its
  schema, so it kept the old version. Nothing was down.

## Out of scope

ARCA and the website: neither keeps a production schema by hand today.
