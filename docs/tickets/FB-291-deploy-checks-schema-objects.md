# FB-291 — A deploy stops unless every schema file's tables, columns, rules and grants are really there

**Status:** Todo · **Kind:** small (about half a day) · **Budget:** none (built in a Claude session, by hand) · **Phase:** 3 · **Raised by:** John, 3 November 2026 ("before every production deploy, check that each schema file's tables, columns, rules and grants really exist, and stop naming what's missing"), to build after the ARCA rehearsal on Friday 6 November 2026 · One ticket = one branch = one PR.

## Why

On 2 November, production's deploy log said: "The database has every schema file this version
needs (15 recorded)." That was not true. On 3 November, a read-only check that John ran on
production found five files that had never been run there:

- `db/002_documents.sql` (documents)
- `db/005_crm.sql` (the CRM)
- `db/005_push.sql` (phones for notices)
- `db/006_voice_usage.sql` (voice allowance)
- `db/007_ticket_machines.sql` (ticket machines)

`db/012_schema_record.sql` had marked every file from 001 to 012 as run, without checking any of
them. The deploy step (`scripts/schema-ready.mjs`, FB-287) reads that list of names. So it checked
the list, not the database. In the dry run that evening, ARCA's founder got no notice, because the
phone table was missing (FB-290). John ran all five files on production on 3 November.

A list of names can say a file ran when it didn't. Only the database itself can say what is in it.

## What to build

**1. The shape the files make, written down from the files themselves.**

- A script runs every `db/*.sql` file, in order, on an empty Postgres (as the tests already do).
  It then writes `db/expected-schema.json`: every schema, table and column (with its type and
  whether it may be empty), whether each table's row rules are on and forced, each rule's name, and
  each right the studio's role (`foundry_studio`) is given, table by table and column by column.
- Each item says which file made it, so a missing item can be traced to the file to run.
- A check in CI fails if `db/expected-schema.json` doesn't match what the files make. So it can't
  fall behind a new file.

**2. The deploy step checks the database against it.**

- `scripts/schema-ready.mjs` keeps its check of names, and adds this one. It signs in as the studio,
  with the `DATABASE_URL` it already has, and reads Postgres's own catalogue. It reads only.
- Each right is checked on its own. (Postgres answers "yes" to a list of rights if any one of them
  is held, which would hide a missing one.)
- If anything is missing, the deploy stops and names each thing and its file, one line each, for
  example: "Missing: table `voicestore.usage` (`db/006_voice_usage.sql`)", or "The studio may not
  delete from `crm_activities` (`db/005_crm.sql`)". Railway keeps the old version running.
- Things in the database that no file made are fine. Supabase adds its own.
- If all is there, the log says how many tables, columns, rules and rights it checked.
- It runs on staging, previews and production. It prints names of tables, columns and rights, never
  an address or a value.

**3. The same check as SQL John can run by hand.**

- `npm run schema-check-sql` prints a read-only SQL check made from `db/expected-schema.json`, to
  paste into Supabase's SQL editor. It lists anything missing, and nothing when all is there. This
  is how John proves production is complete before this change, or any `db/` change, merges.

## What could go wrong

- **A false stop blocks every production deploy.** Before this merges, John runs the SQL from part 3
  on production, and it must show nothing missing. Then the first deploy can't stop by mistake.
- **Postgres names a type differently in another version** (Supabase may run a newer Postgres than
  CI). The names compared are the ones Postgres prints for the types these files use, which have
  not changed between versions. A test covers each type the files use.
- **A later file drops or renames something.** The written shape is what all the files make
  together, in order, so a dropped column is not expected.

## Done when

- [ ] With every file run, the deploy step passes and says how many things it checked.
- [ ] On a test database, taking away a table, a column, a forced rule, a rule, or a single right
  (each in turn) makes the step stop and name that thing and its file. Each such test fails with
  the new check taken out.
- [ ] A test database made like production on 2 November (every file recorded, five never run)
  makes the step stop, naming the five files' tables.
- [ ] CI fails when a `db/` file changes and `db/expected-schema.json` doesn't.
- [ ] Before merge, John runs `npm run schema-check-sql`'s SQL on production: nothing missing.
- [ ] After merge, production's deploy log shows the new check passing.

## When

After Friday's rehearsal, not before. Production is now complete: John's check on 3 November found
every table and rule from 001 to 014. Nothing planned before Friday adds a `db/` file. And a new
gate on deploys that misfires would stop the deploys we need on Wednesday and Thursday, such as
#422. Until this is built, any pull request that adds a `db/` file waits until John has run a
read-only check like the one from 3 November on production.
