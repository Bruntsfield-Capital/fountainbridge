// The rules for "is this database's schema ready for the code about to be deployed" (FB-287), kept
// apart from the command in scripts/schema-ready.mjs so they can be tested without a database.

import { schemaFiles } from './apply-schema-lib.mjs';

/** The table each schema file records itself in, from db/012_schema_record.sql on. */
export const READY_TABLE = 'foundry_meta.schema_files';

/** The first file that records itself (and lists every file before it). */
export const FIRST_RECORDING = '012_schema_record.sql';

/** The schema files in the code that the database has not recorded, in order. */
export function missingFiles(all, recorded) {
  const have = new Set(recorded);
  return schemaFiles(all).filter((f) => !have.has(f));
}

/** The names a schema file's SQL records in READY_TABLE. */
export function namesRecorded(sql) {
  const names = [];
  const insert = /insert\s+into\s+foundry_meta\.schema_files\s*\(\s*name\s*\)\s*values\s*([^;]*)/gi;
  for (const m of sql.matchAll(insert)) {
    for (const v of m[1].matchAll(/\(\s*'([^']+)'\s*\)/g)) names.push(v[1]);
  }
  return names;
}

/**
 * What is wrong with how the schema files record themselves, as one line each (none when right):
 * FIRST_RECORDING lists every file up to itself, and each later file lists itself and no other.
 */
export function recordingProblems(files) {
  const names = schemaFiles(Object.keys(files));
  const problems = [];
  for (const f of names) {
    if (f < FIRST_RECORDING) continue;
    const got = namesRecorded(files[f]);
    const want = f === FIRST_RECORDING ? names.filter((n) => n <= f) : [f];
    if (got.length !== want.length || got.some((n, i) => n !== want[i])) {
      problems.push(
        f === FIRST_RECORDING
          ? `${f} must list every schema file up to itself, in order. It lists: ${got.join(', ') || 'none'}.`
          : `${f} must end by recording itself: insert into ${READY_TABLE} (name) values ('${f}') on conflict (name) do nothing;`,
      );
    }
  }
  return problems;
}

/**
 * The tables the schema files make that have no row-level security, or no rule for it, one line
 * each (FB-288). Supabase can switch row-level security on by itself for a new table, and with no
 * rule the studio's role then reads nothing. So every table switches it on, and gives its rule, in
 * the schema files themselves.
 */
export function tablesWithoutRules(files) {
  const all = Object.values(files).map((sql) => sql.replace(/--[^\n]*/g, '')).join('\n');
  const made = [...all.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_.]*)/gi)].map((m) => m[1].toLowerCase());
  const problems = [];
  for (const table of [...new Set(made)].sort()) {
    const name = table.replace(/\./g, '\\.');
    const on = new RegExp(`alter\\s+table\\s+${name}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(all);
    const rule = new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+${name}\\b`, 'i').test(all);
    if (!on) problems.push(`${table}: switch row-level security on for it ("alter table ${table} enable row level security").`);
    if (!rule) problems.push(`${table}: give it a rule ("create policy ... on ${table} ..."), so the studio can read what it needs.`);
  }
  return problems;
}
