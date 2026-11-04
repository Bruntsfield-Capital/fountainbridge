#!/usr/bin/env node
/**
 * A test copy of the studio, with its own throwaway database (FB-272).
 *
 * The factory starts one of these for each run, signs in to it and checks it. So can a person:
 *
 *   npm run build                                        # once, after any change
 *   node scripts/test-copy.mjs start --port 3100         # runs until stopped
 *   node scripts/test-copy.mjs stop  --state <folder>    # from another terminal, or Ctrl+C
 *
 * What `start` does, in order:
 *
 *   1. Refuses to go on if DATABASE_URL is already set to anything but a throwaway database on this
 *      machine. A test copy must never touch Supabase, staging or production.
 *   2. Drops any throwaway database an earlier test copy left behind (one that was killed and so
 *      could not clean up after itself).
 *   3. Makes a new database for this run, named `fb_test_<time>_<random>`, on this machine's
 *      Postgres (through its socket, `/var/run/postgresql`).
 *   4. Applies every `db/*.sql` file to it, in order.
 *   5. Starts the built studio on the port given, with the same test settings Playwright uses
 *      (`e2e/server-env.mjs`): the test fixtures instead of GitHub, and the test sign-in door. The
 *      studio connects to the new database as `foundry_studio`, so row-level security applies as
 *      it does in production.
 *   6. Prints where it is and where its state folder is, and keeps running.
 *
 * Stopping it (Ctrl+C, `stop`, or the studio exiting) stops the studio and drops the database. If it
 * is killed outright, the next `start` or `sweep` drops what it left.
 *
 * The other commands: `sweep` drops left-behind databases now; `list` shows this user's throwaway
 * databases.
 *
 * Settings: `--port` (or FACTORY_RUNTIME_PORT), `--state <folder>` (or FACTORY_RUNTIME_STATE; a new
 * temporary folder otherwise), TEST_COPY_PG_SOCKET for a different socket folder, and
 * TEST_COPY_PG_ADMIN_DB for the database it connects to first, to make and drop the throwaway ones
 * (`postgres` by default; the factory's user may not connect there, so the factory names its own,
 * `archon_factory`).
 *
 * The user running this needs to be able to make databases on the local Postgres (CREATEDB), and to
 * act as `foundry_studio` (membership in that role). A superuser can do both.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { hostname, tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { studioTestEnv } from '../e2e/server-env.mjs';
import {
  PREFIX, STUDIO_ROLE, THROWAWAY_NAME, isLeftBehind, newDatabaseName, ownerNote, studioDatabaseUrl,
  throwawayProblem,
} from './test-copy-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOCKET = process.env.TEST_COPY_PG_SOCKET || '/var/run/postgresql';
const ADMIN_DB = process.env.TEST_COPY_PG_ADMIN_DB || 'postgres';
const USER = userInfo().username;
const STATE_FILE = 'test-copy.json';

/**
 * What the studio inherits from whoever started this. Deliberately short: a person's shell may hold
 * a real GitHub token or a real database address, and a test copy must never be able to use them.
 */
const INHERITED = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'TMP', 'TEMP', 'TZ'];

function say(line) {
  process.stdout.write(`[test-copy] ${line}\n`);
}

function fail(line, code = 2) {
  process.stderr.write(`[test-copy] ${line}\n`);
  process.exit(code);
}

function option(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) fail(`${name} needs a value.`);
  return value;
}

/** A connection as the person running this, to the database named, through the socket. */
async function adminClient(database = ADMIN_DB) {
  const client = new pg.Client({ host: SOCKET, user: USER, database });
  try {
    await client.connect();
  } catch (e) {
    fail(`Cannot reach Postgres through ${SOCKET} as "${USER}": ${e.message}`);
  }
  return client;
}

/** Quote a name for SQL. Only ever given names that already passed THROWAWAY_NAME. */
function ident(name) {
  if (!THROWAWAY_NAME.test(name)) throw new Error(`refusing a database that is not a throwaway: ${name}`);
  return `"${name}"`;
}

/** This user's throwaway databases, with the note each was made with. */
async function ownDatabases(admin) {
  const r = await admin.query(
    `select datname as name, shobj_description(oid, 'pg_database') as note
       from pg_database
      where datname like $1 and pg_get_userbyid(datdba) = current_user
      order by datname`,
    [`${PREFIX}%`],
  );
  return r.rows.filter((row) => THROWAWAY_NAME.test(row.name));
}

async function dropDatabase(admin, name) {
  await admin.query(`drop database if exists ${ident(name)} with (force)`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // it exists; it belongs to someone else
  }
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch (e) {
    return e.code !== 'ENOENT'; // a folder we may not look into still exists
  }
}

async function sweep(admin) {
  const here = { host: hostname(), alive, exists };
  const dropped = [];
  for (const db of await ownDatabases(admin)) {
    if (isLeftBehind(db.note, here)) {
      await dropDatabase(admin, db.name);
      dropped.push(db.name);
    }
  }
  return dropped;
}

/** The commit this folder is at, or undefined when it is not a git checkout of its own. */
function commit() {
  const git = (...args) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    // Only this folder's own history. A copy of the files placed inside some other checkout would
    // otherwise report that checkout's commit as its own.
    if (resolve(git('rev-parse', '--show-toplevel')) !== ROOT) return undefined;
    return git('rev-parse', 'HEAD');
  } catch {
    return undefined; // a copy of the files with no git history, as the factory's runtime host makes
  }
}

async function start(args) {
  const port = option(args, '--port') ?? process.env.FACTORY_RUNTIME_PORT;
  if (!port || !/^\d{2,5}$/.test(port)) fail('Say which port: --port 3100.');

  // 1. Never anything but a throwaway database on this machine.
  const preset = process.env.DATABASE_URL;
  if (preset !== undefined && preset.trim() !== '') {
    const problem = throwawayProblem(preset);
    if (problem) {
      fail(`DATABASE_URL is set, and a test copy must never use it. ${problem} Nothing was started. Unset DATABASE_URL and try again.`);
    }
    say('DATABASE_URL is set to a throwaway database. It is ignored: this run makes its own.');
  }

  if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
    fail('The studio has not been built here. Run "npm run build" first.');
  }

  const state = resolve(option(args, '--state') ?? process.env.FACTORY_RUNTIME_STATE ?? mkdtempSync(join(tmpdir(), 'fb-test-copy-')));
  mkdirSync(state, { recursive: true });

  const admin = await adminClient();
  // 2. What earlier copies left behind.
  const swept = await sweep(admin);
  if (swept.length) say(`Dropped ${swept.length} database(s) an earlier test copy left behind: ${swept.join(', ')}`);

  // 3. This run's database.
  const database = newDatabaseName();
  const note = ownerNote({ host: hostname(), pid: process.pid, state, started: new Date().toISOString() });
  await admin.query(`create database ${ident(database)}`);
  // The box's rule for every new database (cowgate OPS.md): nobody else may connect to it. Its
  // owner, who is the one running this, still can.
  await admin.query(`revoke connect on database ${ident(database)} from public`);
  await admin.query(`comment on database ${ident(database)} is ${pg.escapeLiteral(note)}`);

  let child = null;
  let finished = false;
  async function finish(code) {
    if (finished) return;
    finished = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((done) => {
        const force = setTimeout(() => child.kill('SIGKILL'), 10_000);
        child.once('exit', () => { clearTimeout(force); done(); });
      });
    }
    try {
      await dropDatabase(admin, database);
      say(`Stopped. Database ${database} dropped.`);
    } catch (e) {
      process.stderr.write(`[test-copy] Could not drop ${database}: ${e.message}. The next start or sweep drops it.\n`);
      code = code || 1;
    }
    rmSync(join(state, STATE_FILE), { force: true });
    await admin.end().catch(() => {});
    process.exit(code);
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => finish(0));

  try {
    // 4. The schema, in order, each file all or nothing.
    const migrations = readdirSync(join(ROOT, 'db')).filter((f) => f.endsWith('.sql')).sort();
    const schema = await adminClient(database);
    try {
      for (const file of migrations) {
        await schema.query('begin');
        await schema.query(readFileSync(join(ROOT, 'db', file), 'utf8'));
        await schema.query('commit');
      }
    } catch (e) {
      await schema.query('rollback').catch(() => {});
      throw new Error(`applying the database files failed: ${e.message}`);
    } finally {
      await schema.end();
    }

    // The address the studio gets, checked once more before it is handed over.
    const url = studioDatabaseUrl({ database, user: USER, socket: SOCKET });
    const problem = throwawayProblem(url);
    if (problem) throw new Error(problem);

    // Prove the studio's connection is bound by row-level security: it must act as foundry_studio,
    // which is neither a superuser nor allowed to skip the policies.
    const probe = new pg.Client({ connectionString: url });
    await probe.connect();
    const who = (await probe.query(
      'select current_user as role, rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    )).rows[0];
    await probe.end();
    if (!who || who.role !== STUDIO_ROLE || who.rolsuper || who.rolbypassrls) {
      throw new Error(`the studio would connect as ${who?.role ?? 'nobody'}, which row-level security does not bind`);
    }

    // 5. The studio.
    const env = {};
    for (const key of INHERITED) if (process.env[key] !== undefined) env[key] = process.env[key];
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('FACTORY_RUNTIME_')) env[key] = value;
    }
    // The state folder, by name, so the studio can write each press there as one line (FB-274,
    // harness/END-TO-END.md: "each decision and press is also written as one line to a file in its
    // state folder").
    Object.assign(env, studioTestEnv({ factoryBuilt: process.env.STUDIO_FACTORY_BUILT ?? '' }), { DATABASE_URL: url, PORT: port, FACTORY_RUNTIME_STATE: state });
    const sha = commit();
    if (sha) env.BUILD_COMMIT_SHA = sha;

    const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
    // This machine only. The copy has the test sign-in door open, which lets anyone in as anyone, so
    // it must not answer on the box's public address.
    child = spawn(process.execPath, [next, 'start', '--port', port, '--hostname', '127.0.0.1'], { cwd: ROOT, env, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      if (!finished) say(`The studio stopped by itself (${signal ?? `exit ${code}`}).`);
      finish(code ?? 1);
    });

    writeFileSync(join(state, STATE_FILE), JSON.stringify({ pid: process.pid, port: Number(port), database, state }, null, 2));
    say(`Database ${database} made, with ${migrations.length} database files applied.`);
    say(`Studio starting at http://127.0.0.1:${port}  (commit ${sha ?? 'unknown'})`);
    say(`State folder: ${state}`);
    say(`Stop it with Ctrl+C, or: node scripts/test-copy.mjs stop --state ${state}`);
  } catch (e) {
    process.stderr.write(`[test-copy] Could not start: ${e.message}\n`);
    await finish(1);
  }
}

async function stop(args) {
  const state = option(args, '--state') ?? process.env.FACTORY_RUNTIME_STATE;
  if (!state) fail('Say which test copy: --state <folder> (start printed it).');
  const file = join(resolve(state), STATE_FILE);
  if (!existsSync(file)) fail(`No test copy is running from ${state}.`, 1);
  const { pid, database } = JSON.parse(readFileSync(file, 'utf8'));
  if (alive(pid)) process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 150 && alive(pid); i++) await new Promise((r) => setTimeout(r, 200));

  const admin = await adminClient();
  if (THROWAWAY_NAME.test(database)) {
    const still = await admin.query('select 1 from pg_database where datname = $1', [database]);
    if (still.rowCount) await dropDatabase(admin, database); // it was killed before it could
  }
  const gone = (await admin.query('select 1 from pg_database where datname = $1', [database])).rowCount === 0;
  await admin.end();
  rmSync(file, { force: true });
  if (!gone) fail(`Database ${database} is still there.`, 1);
  say(`Stopped. Database ${database} is gone.`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'start') return start(args);
  if (command === 'stop') return stop(args);
  if (command === 'sweep') {
    const admin = await adminClient();
    const dropped = await sweep(admin);
    await admin.end();
    say(dropped.length ? `Dropped: ${dropped.join(', ')}` : 'Nothing was left behind.');
    return;
  }
  if (command === 'list') {
    const admin = await adminClient();
    const rows = await ownDatabases(admin);
    await admin.end();
    say(rows.length ? rows.map((r) => r.name).join('\n') : `No ${PREFIX} databases.`);
    return;
  }
  fail('Use: node scripts/test-copy.mjs start --port <port> [--state <folder>] | stop --state <folder> | sweep | list');
}

main().catch((e) => fail(e.message, 1));
