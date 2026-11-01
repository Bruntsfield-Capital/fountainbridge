-- Which schema files this database has (FB-287; John, 1 November 2026).
--
-- On 1 November #412 was deployed to production before db/011 had been run there, and for five
-- minutes the studio could not record a press. Production's schema is kept by hand, so before each
-- deploy scripts/schema-ready.mjs now reads this table: every db/*.sql file in the code being
-- deployed must be listed here, or the deploy stops and Railway keeps the old version running.
--
--   `foundry_meta.schema_files` — one row per schema file this database has had run. The studio's
--   role may read it, and nothing more. Not the same table as `public.schema_files`, which
--   scripts/apply-schema.mjs keeps for itself on staging and previews only, with each file's hash.
--
-- This file lists every file up to and including itself. From 013 on, each file ends by listing
-- itself, so running the file is what records it. scripts/__tests__/schema-ready.test.mjs fails if
-- one doesn't.
--
-- Written so that running it twice changes nothing.

create schema if not exists foundry_meta;

create table if not exists foundry_meta.schema_files (
  name         text primary key,
  recorded_at  timestamptz not null default now()
);

revoke all on foundry_meta.schema_files from public;
grant usage on schema foundry_meta to foundry_studio;
grant select on foundry_meta.schema_files to foundry_studio;

insert into foundry_meta.schema_files (name) values
  ('001_read_model.sql'),
  ('002_documents.sql'),
  ('003_document_bytes.sql'),
  ('004_run_reports_cache.sql'),
  ('005_crm.sql'),
  ('005_push.sql'),
  ('006_voice_usage.sql'),
  ('007_ticket_machines.sql'),
  ('008_factory_cards.sql'),
  ('009_factory_presses.sql'),
  ('010_press_lapses.sql'),
  ('011_follow_ups.sql'),
  ('012_schema_record.sql')
on conflict (name) do nothing;
