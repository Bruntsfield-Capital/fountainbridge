-- The studio may read the list of schema files, wherever row-level security is on (FB-288).
--
-- On 2 November production's first deploy after FB-287 stopped: Supabase had switched row-level
-- security on for foundry_meta.schema_files by itself when 012 made it, and with no rule the
-- studio's role read no rows, so scripts/schema-ready.mjs found none of the files. John added this
-- rule by hand on production. This file is the same rule, so every database matches.
--
-- Row-level security is switched on here too, as for every other table (CLAUDE.md #6). The rule
-- lets the studio's role read the list, which is file names only. Nothing but the owner, who runs
-- these files, may add to it.
--
-- Written so that running it twice changes nothing.

alter table foundry_meta.schema_files enable row level security;

drop policy if exists schema_files_studio_reads on foundry_meta.schema_files;
create policy schema_files_studio_reads on foundry_meta.schema_files
  for select to foundry_studio using (true);

insert into foundry_meta.schema_files (name) values ('013_schema_record_readable.sql') on conflict (name) do nothing;
