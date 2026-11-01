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
