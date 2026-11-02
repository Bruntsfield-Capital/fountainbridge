// FB-287, lock 2: a deploy stops when the database lacks a schema file the code has, so the old
// version keeps running.
//
// The rules are tested without a database, and over the real db/ files. The check itself is tested
// against a throwaway database on the planning box's Postgres, and skipped (saying so) where there
// is none, as in CI.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema } from '../apply-schema.mjs';
import { FIRST_RECORDING, missingFiles, namesRecorded, recordingProblems, tablesWithoutRules } from '../schema-ready-lib.mjs';
import { schemaReady } from '../schema-ready.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const DB_DIR = join(root, 'db');
const realFiles = () => Object.fromEntries(readdirSync(DB_DIR).filter((f) => f.endsWith('.sql')).map((f) => [f, readFileSync(join(DB_DIR, f), 'utf8')]));
const record = (f) => `insert into foundry_meta.schema_files (name) values ('${f}') on conflict (name) do nothing;`;

describe('every schema file records itself', () => {
  it('holds for the db/ files in this repository', () => {
    expect(recordingProblems(realFiles())).toEqual([]);
  });

  it(`${FIRST_RECORDING} lists every file before it, and itself`, () => {
    const files = realFiles();
    expect(namesRecorded(files[FIRST_RECORDING])).toEqual(Object.keys(files).sort().filter((f) => f <= FIRST_RECORDING));
  });

  it('fails for a new file that does not record itself, naming it and the line to add', () => {
    const files = { ...realFiles(), '013_new.sql': 'create table x (id int);' };
    expect(recordingProblems(files)).toEqual([`013_new.sql must end by recording itself: ${record('013_new.sql')}`]);
  });

  it('fails for a new file that records another name', () => {
    const files = { ...realFiles(), '013_new.sql': `create table x (id int);\n${record('014_other.sql')}` };
    expect(recordingProblems(files)).toHaveLength(1);
  });

  it(`fails when ${FIRST_RECORDING} leaves a file out`, () => {
    const files = realFiles();
    files[FIRST_RECORDING] = files[FIRST_RECORDING].replace("  ('005_push.sql'),\n", '');
    expect(recordingProblems(files)[0]).toMatch(new RegExp(`^${FIRST_RECORDING} must list every schema file`));
  });

  it('passes a new file that records itself', () => {
    expect(recordingProblems({ ...realFiles(), '013_new.sql': `create table x (id int);\n\n${record('013_new.sql')}\n` })).toEqual([]);
  });
});

describe('every table has row-level security and a rule (FB-288)', () => {
  // Supabase can switch row-level security on by itself for a new table; with no rule the studio
  // then reads nothing, as production did on 2 November.
  it('holds for the db/ files in this repository', () => {
    expect(tablesWithoutRules(realFiles())).toEqual([]);
  });

  it('fails for a new table with neither, naming both', () => {
    const files = { ...realFiles(), '099_new.sql': 'create table if not exists foundry_meta.notes (id int);' };
    expect(tablesWithoutRules(files)).toEqual([
      'foundry_meta.notes: switch row-level security on for it ("alter table foundry_meta.notes enable row level security").',
      'foundry_meta.notes: give it a rule ("create policy ... on foundry_meta.notes ..."), so the studio can read what it needs.',
    ]);
  });

  it('fails for a table with row-level security on but no rule, as 012 alone was', () => {
    const files = realFiles();
    delete files['013_schema_record_readable.sql'];
    files['012_schema_record.sql'] += '\nalter table foundry_meta.schema_files enable row level security;\n';
    expect(tablesWithoutRules(files)).toEqual([expect.stringMatching(/^foundry_meta\.schema_files: give it a rule/)]);
  });

  it('does not count a table named only in a comment', () => {
    expect(tablesWithoutRules({ 'a.sql': '-- create table x.y (id int);' })).toEqual([]);
  });
});

describe('which files are missing', () => {
  it('names the .sql files the database has not recorded, in order', () => {
    expect(missingFiles(['README.md', '013_b.sql', '001_a.sql', '012_c.sql'], ['001_a.sql'])).toEqual(['012_c.sql', '013_b.sql']);
    expect(missingFiles(['001_a.sql'], ['001_a.sql', '999_from_a_later_version.sql'])).toEqual([]);
  });
});

describe('the deploy runs it, after the schema is loaded', () => {
  it("is package.json's before-deploy, after apply-schema", () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['before-deploy']).toBe('node scripts/apply-schema.mjs && node scripts/schema-ready.mjs');
  });
});

// The real thing, against this machine's Postgres: a throwaway database loaded as staging is.
const SOCKET = '/var/run/postgresql';
const tag = randomBytes(3).toString('hex');
const DB = `fb_test_ready_${tag}`;
const ROLE = `fb_test_role_${tag}`;
const url = `postgresql:///${DB}?host=${SOCKET}`;
let admin = null;

async function reachable() {
  const c = new pg.Client({ host: SOCKET, database: 'postgres' });
  try {
    await c.connect();
    return c;
  } catch {
    return null;
  }
}

async function onDb(sql) {
  const c = new pg.Client({ host: SOCKET, database: DB });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

describe('checking a real database', () => {
  beforeAll(async () => {
    admin = await reachable();
    if (!admin) return;
    await admin.query(`create database ${DB}`);
    await admin.query(`create role ${ROLE} nologin`);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.query(`drop database if exists ${DB}`);
    await admin.query(`drop role if exists ${ROLE}`);
    await admin.end();
  });

  it('stops when the database has no record at all, saying what to run', async (ctx) => {
    if (!admin) return ctx.skip(); // no local Postgres here (CI): the rules above still ran
    await expect(schemaReady({ url, log: () => {} })).rejects.toThrow(/has no foundry_meta.schema_files\. Run db\/012_schema_record\.sql/);
  });

  it('passes once every file has been run, as on staging', async (ctx) => {
    if (!admin) return ctx.skip();
    await applySchema({ url, role: ROLE, allowLocal: true, log: () => {} });
    const lines = [];
    await schemaReady({ url, log: (m) => lines.push(m) });
    expect(lines[0]).toMatch(/has every schema file this version needs/);
  });

  it('stops, naming the file, when the code has one the database has not had', async (ctx) => {
    if (!admin) return ctx.skip();
    const dir = mkdtempSync(join(tmpdir(), 'fb287-'));
    for (const [f, sql] of Object.entries(realFiles())) writeFileSync(join(dir, f), sql);
    writeFileSync(join(dir, '013_new.sql'), `create table x (id int);\n${record('013_new.sql')}\n`);
    await expect(schemaReady({ url, dir, log: () => {} })).rejects.toThrow(
      'The database does not have 013_new.sql. Run it on it, then deploy again. The version already running keeps running.',
    );
  });

  it('stops when a file was never recorded, as on production before John runs it', async (ctx) => {
    if (!admin) return ctx.skip();
    await onDb(`delete from foundry_meta.schema_files where name = '011_follow_ups.sql'`);
    await expect(schemaReady({ url, log: () => {} })).rejects.toThrow(/does not have 011_follow_ups\.sql\./);
  });

  it('lets the studio read the list with row-level security on, as on production (FB-288)', async (ctx) => {
    if (!admin) return ctx.skip();
    const c = new pg.Client({ host: SOCKET, database: DB });
    await c.connect();
    try {
      const on = (await c.query(`select relrowsecurity from pg_class where oid = 'foundry_meta.schema_files'::regclass`)).rows[0];
      expect(on).toEqual({ relrowsecurity: true });
      await c.query('begin');
      await c.query('set local role foundry_studio');
      const seen = (await c.query('select count(*)::int as n from foundry_meta.schema_files')).rows[0].n;
      await c.query('rollback');
      expect(seen).toBeGreaterThanOrEqual(13);
    } finally {
      await c.end();
    }
  });

  it("lets the studio's role read the record, and nothing more", async (ctx) => {
    if (!admin) return ctx.skip();
    // Privileges are per database, so ask inside it.
    const c = new pg.Client({ host: SOCKET, database: DB });
    await c.connect();
    const rights = (await c.query(
      `select has_table_privilege('foundry_studio', 'foundry_meta.schema_files', 'select') as can_read,
              has_table_privilege('foundry_studio', 'foundry_meta.schema_files', 'insert') as can_write`,
    )).rows[0];
    await c.end();
    expect(rights).toEqual({ can_read: true, can_write: false });
  });
});
