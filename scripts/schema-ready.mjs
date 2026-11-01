#!/usr/bin/env node
// Stops a deploy whose schema isn't in the database yet (FB-287). Railway runs it before each
// deploy, after scripts/apply-schema.mjs (`npm run before-deploy`).
//
// What it does, in order:
//   1. Does nothing if DATABASE_URL is not set: a studio with no database has no schema to need.
//   2. Signs in as the studio, with the DATABASE_URL it already has, and reads which schema files
//      the database has from foundry_meta.schema_files (db/012_schema_record.sql). It reads only.
//   3. Every db/*.sql file in the code being deployed must be there. If one is not, it names the
//      missing files and exits non-zero, which stops the deploy: Railway keeps the old version
//      running. On staging and previews, apply-schema.mjs has just run the files, and each records
//      itself, so this passes. On production, where the schema is run by hand, it passes once John
//      has run them.
//
// It prints file names only, never the address or a value.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { READY_TABLE, missingFiles } from './schema-ready-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const say = (m) => console.log(`[schema-ready] ${m}`);

/** Throws, naming what is missing, unless the database at `url` has every file in `dir`. */
export async function schemaReady({ url, dir = join(ROOT, 'db'), log = say }) {
  const local = ['', 'localhost', '127.0.0.1'].includes(new URL(url).hostname);
  // As lib/db.ts: Supabase's pooler presents its own certificate, so the name check is given up.
  const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 20_000 });
  try {
    await client.connect();
  } catch (e) {
    // The driver's own message can name the host, so only its code is passed on.
    throw new Error(`Could not reach the database (${e.code ?? 'no error code'}).`);
  }
  let recorded;
  try {
    recorded = (await client.query(`select name from ${READY_TABLE}`)).rows.map((r) => r.name);
  } catch (e) {
    if (e.code === '42P01' || e.code === '3F000') {
      throw new Error(`The database has no ${READY_TABLE}. Run db/012_schema_record.sql on it first, then every schema file after it.`);
    }
    if (e.code === '42501') throw new Error(`The studio's role may not read ${READY_TABLE}. db/012_schema_record.sql grants it.`);
    throw new Error(`Could not read ${READY_TABLE} (${e.code ?? 'no error code'}).`);
  } finally {
    await client.end();
  }
  const missing = missingFiles(readdirSync(dir), recorded);
  if (missing.length) {
    throw new Error(`The database does not have ${missing.join(', ')}. Run ${missing.length > 1 ? 'them' : 'it'} on it, then deploy again. The version already running keeps running.`);
  }
  log(`The database has every schema file this version needs (${recorded.length} recorded).`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    say('DATABASE_URL is not set: this studio has no database, so no schema to check.');
    process.exit(0);
  }
  schemaReady({ url }).then(
    () => process.exit(0),
    (e) => {
      console.error(`[schema-ready] ${e.message}`);
      process.exit(1);
    },
  );
}
