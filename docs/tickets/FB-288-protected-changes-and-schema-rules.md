# FB-288 — The studio can read the schema list everywhere, and every table brings its own rule

**Status:** Done · **Kind:** small · **Budget:** none (built in a Claude session, by hand) · **Phase:** 3 · **Raised by:** John, 2 November 2026 ("Put db/013 in the protected-files follow-up: the same policy, safe to run twice, recording itself. Also check whether any other table the studio reads could be hit by Supabase switching row-level security on for new tables") · One ticket = one branch = one PR.

## Why

On 2 November production's first deploy after FB-287 stopped: Supabase had switched row-level
security on for `foundry_meta.schema_files` by itself, with no rule, so the studio read no rows
from it (FB-287, "What happened on production"). John added the rule by hand. The repository needs
the same rule, and a guard so no other table can be caught the same way.

## What was built

- `db/013_schema_record_readable.sql`: switches row-level security on for
  `foundry_meta.schema_files` and gives the studio's role the rule John added on production
  (`schema_files_studio_reads`, read only). It drops the rule before making it, so running it twice
  changes nothing, and it records itself.
- A test over every `db/*.sql` file (`tablesWithoutRules` in `scripts/schema-ready-lib.mjs`): each
  table the schema makes must switch row-level security on and have a rule, in the files
  themselves. It fails, naming the table and the line to add, for one that doesn't.
- A test against a throwaway database: with row-level security on, the studio's role still reads
  the list.
- `docs/tickets/FB-287-production-sql-first.md`: what happened on production on 1–2 November, and
  its last two boxes ticked.

## The other tables (checked 2 November)

Every other table the studio reads already switches row-level security on and has a rule in its
own schema file: `ventures`, `run_reports`, `documents`, `docstore.blobs`, the four CRM tables,
`pushstore.subscriptions` and `queue_watch`, `voicestore.usage`, the four `machinestore` tables,
and `factorystore.cards`, `pictures`, `heartbeats` and `presses`. So Supabase switching it on for
them changes nothing. FB-279's two new tables (#414) do the same. `public.schema_files`, which
`apply-schema.mjs` keeps, lives only on staging and previews, never on Supabase. The new test keeps
it that way for every table to come.

## For John, on production

Run `db/013`, whole, before adding the label. Its rule is the one you added by hand, so that part
changes nothing, but it also adds its own name to the list. Production's next deploy needs that
name, or it stops and keeps the old version.

## Done when

- [x] `db/013` gives the studio its read rule, runs twice safely, and records itself.
- [x] A test fails for any table without row-level security and a rule; it passes for every table
  today.
- [x] Each rule, taken out, is caught by a test.
- [x] Every command in `CLAUDE.md` `## Checks` passes.

## Out of scope

Which pull requests the factory may merge: protected files, including `.github/workflows/` and
`scripts/production-sql-*`, are cowgate's CG-0081, because the factory's merge step and its watch on
`main` live there.
