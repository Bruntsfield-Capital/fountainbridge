import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sqlCardStore, type CardStore, type Querier } from '../card-store';
import { PRESS_SQL, type Room } from '../press-store';
import { stateFrom } from '../review';
import { putTestCards, storedCard } from './review-fixtures';

/**
 * FB-276: the press store, against real Postgres, connected as the studio's own role.
 *
 * The store's own statements (`PRESS_SQL` in lib/press-store.ts) run here, inside a transaction
 * scoped to one venture exactly as `withVenture` scopes it. What is proven is the database's rule:
 * a connection scoped to ARCA cannot read, add or change THE RESET's presses; a founder's Approve
 * cannot be written at all; and a second standing press on one card cannot be written either.
 */

const SCHEMA = ['001_read_model.sql', '008_factory_cards.sql', '009_factory_presses.sql', '010_press_lapses.sql']
  .map((f) => readFileSync(join(process.cwd(), 'db', f), 'utf8'));

const FOUNDER = 'arca.founder@bruntsfield.capital';
const ROSS = 'ross@bruntsfield.capital';
const JOHN = 'john.gallagher@wealthcx.com';
const ROOM: Room = { limit: 20, bytes: 56 * 1024, size: (p) => Buffer.byteLength(JSON.stringify(p)) };

let db: PGlite;
let store: CardStore;

async function scoped<T>(ventureId: string | null, fn: (q: Querier) => Promise<T>): Promise<T> {
  await db.exec('begin');
  try {
    if (ventureId !== null) await db.query("select set_config('app.venture_id', $1, true)", [ventureId]);
    const out = await fn(db as unknown as Querier);
    await db.exec('commit');
    return out;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

/** As the owner, which row-level security still binds (FORCE), but grants do not. */
async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec('reset role');
  try {
    return await fn();
  } finally {
    await db.exec('set role foundry_studio');
  }
}

const press = (ventureId: string, repo: string, number: number, action: Parameters<CardStore['press']>[1]['action'], by: string, byJohn: boolean, seenHeadSha: string | null = null) =>
  store.press(ventureId, { repo, number, action, by, byJohn, note: '', seenHeadSha });

beforeAll(async () => {
  db = await PGlite.create();
  for (const file of SCHEMA) await db.exec(file);
  await db.exec('set role foundry_studio');
  store = sqlCardStore({ asVenture: (id, fn) => scoped(id, fn), asNobody: (fn) => scoped(null, fn) });
});

beforeEach(async () => {
  // Every test starts with the three test cards and no presses. Only the owner may delete.
  await asOwner(async () => {
    await db.exec('delete from factorystore.presses; delete from factorystore.pictures; delete from factorystore.cards');
  });
  await putTestCards(store);
});

afterAll(async () => {
  await db.close();
});

describe('the schema', () => {
  it('loads a second time without changing anything', async () => {
    expect(await press('arca', 'arca', 21, 'accept', FOUNDER, false)).toBe('recorded');
    await asOwner(() => db.exec(SCHEMA[2] + SCHEMA[3]));
    expect(await store.presses('arca', 'arca', 21)).toHaveLength(1);
  });

  it("is bound by row-level security for the studio's role", async () => {
    const who = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    expect(who.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe("one venture cannot reach another's presses", () => {
  beforeEach(async () => {
    expect(await press('the-reset', 'thereset-platform', 5, 'send-back', ROSS, false)).toBe('recorded');
  });

  it("ARCA's scope reads none of THE RESET's presses, by any key", async () => {
    expect(await store.presses('arca', 'thereset-platform', 5)).toEqual([]);
    const rows = await scoped('arca', (q) => q.query('select * from factorystore.presses'));
    expect(rows.rows).toEqual([]);
    expect(await store.presses('the-reset', 'thereset-platform', 5)).toHaveLength(1);
  });

  it('no scope at all sees no press', async () => {
    expect((await scoped(null, (q) => q.query('select 1 from factorystore.presses'))).rows).toEqual([]);
  });

  it("ARCA's scope cannot write a press under THE RESET, nor press THE RESET's card", async () => {
    await expect(scoped('arca', (q) => q.query(
      "insert into factorystore.presses (venture_id, repo, number, action, by_email, by_john) values ('the-reset', 'thereset-platform', 5, 'stop', 'x@y', false)",
    ))).rejects.toThrow(/row-level security|foreign key/);
    expect(await press('arca', 'thereset-platform', 5, 'stop', FOUNDER, false)).toBe('no-card');
    expect(await store.presses('the-reset', 'thereset-platform', 5)).toHaveLength(1);
  });

  it("ARCA's scope cannot answer or collect THE RESET's press", async () => {
    const [theirs] = await store.presses('the-reset', 'thereset-platform', 5);
    expect(await store.answer(['arca'], theirs.id, 'done', 'Done.')).toBe('no-press');
    await scoped('arca', (q) => q.query("update factorystore.presses set outcome = 'done', message = 'x', answered_at = now()"));
    expect((await store.collect(['arca'], ROOM)).presses).toEqual([]);
    const [still] = await store.presses('the-reset', 'thereset-platform', 5);
    expect(still.answer).toBeNull();
    expect(still.collectedAt).toBeNull();
  });
});

describe('the second walls', () => {
  it("a founder's Approve, Reject, Try again or Split it cannot be written at all", async () => {
    for (const action of ['approve', 'reject', 'try-again', 'split']) {
      await expect(scoped('arca', (q) => q.query(
        "insert into factorystore.presses (venture_id, repo, number, action, by_email, by_john, seen_head_sha) values ('arca', 'arca', 21, $1, $2, false, 'sha-arca-21')",
        [action, FOUNDER],
      ))).rejects.toThrow(/presses_john_only/);
    }
    expect(await store.presses('arca', 'arca', 21)).toEqual([]);
  });

  it('two presses that both passed the checks at once: the second is not written', async () => {
    // What two simultaneous presses would do if the card's row lock were ever lost: both insert.
    const insert = () => scoped('arca', (q) => q.query(PRESS_SQL.insert, ['arca', 21, 'approve', JOHN, true, '', 'sha-arca-21']));
    expect((await insert()).rows).toHaveLength(1);
    expect((await insert()).rows).toHaveLength(0);
    await expect(scoped('arca', (q) => q.query(
      "insert into factorystore.presses (venture_id, repo, number, action, by_email, by_john, seen_head_sha) values ('arca', 'arca', 21, 'stop', $1, false, 'sha-arca-21')",
      [FOUNDER],
    ))).rejects.toThrow(/presses_one_standing/);
    expect(await store.presses('arca', 'arca', 21)).toHaveLength(1);
  });

  it('the studio may change only what the box adds later, and may delete nothing', async () => {
    await press('arca', 'arca', 21, 'accept', FOUNDER, false);
    await expect(scoped('arca', (q) => q.query("update factorystore.presses set by_john = true"))).rejects.toThrow(/permission denied/);
    await expect(scoped('arca', (q) => q.query("update factorystore.presses set action = 'approve'"))).rejects.toThrow(/permission denied/);
    await expect(scoped('arca', (q) => q.query('delete from factorystore.presses'))).rejects.toThrow(/permission denied/);
  });

  it('an answer is whole, or not there', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    await expect(scoped('arca', (q) => q.query("update factorystore.presses set outcome = 'done'"))).rejects.toThrow(/presses_answer_whole/);
  });
});

describe('a press, through the store', () => {
  it('the first press wins; a sign-off does not settle the card', async () => {
    expect(await press('arca', 'arca', 21, 'accept', FOUNDER, false)).toBe('recorded');
    expect(await press('arca', 'arca', 21, 'accept', FOUNDER, false)).toBe('already-signed-off');
    expect(await press('arca', 'arca', 21, 'approve', JOHN, true)).toBe('recorded');
    expect(await press('arca', 'arca', 21, 'reject', JOHN, true)).toBe('out-of-date');
    expect(await press('arca', 'arca', 21, 'accept', FOUNDER, false)).toBe('out-of-date');
    expect((await store.presses('arca', 'arca', 21)).map((p) => [p.action, p.by])).toEqual([['accept', FOUNDER], ['approve', JOHN]]);
  });

  it('is refused on a version the person was not shown, and kept with the one they were', async () => {
    expect(await press('arca', 'arca', 21, 'accept', FOUNDER, false, 'sha-older')).toBe('changed');
    expect(await press('arca', 'arca', 21, 'accept', FOUNDER, false, 'sha-arca-21')).toBe('recorded');
    expect((await store.presses('arca', 'arca', 21))[0].seenHeadSha).toBe('sha-arca-21');
  });

  it('a press the box said did nothing no longer stands; one it did, does', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    const [first] = await store.presses('arca', 'arca', 21);
    expect(await store.answer(['arca'], first.id, 'out-of-date', 'Nothing was done.')).toBe('stored');
    expect(await press('arca', 'arca', 21, 'try-again', JOHN, true)).toBe('recorded');
    const [, second] = await store.presses('arca', 'arca', 21);
    expect(await store.answer(['arca'], second.id, 'done', 'Started again.')).toBe('stored');
    expect(await press('arca', 'arca', 21, 'stop', JOHN, true)).toBe('out-of-date');
  });

  it('a new version of the card starts with no presses', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    await store.putCard('arca', { ...storedCard('arca', 21), headSha: 'sha-new', sentAt: '2026-08-01T00:00:00.000Z' });
    expect(await store.presses('arca', 'arca', 21)).toEqual([]);
    expect(await press('arca', 'arca', 21, 'accept', FOUNDER, false, 'sha-new')).toBe('recorded');
  });
});

describe('what the box collects', () => {
  it('presses across every venture, oldest first; sign-offs separately; each only once', async () => {
    await press('arca', 'arca', 21, 'accept', FOUNDER, false);
    await press('the-reset', 'thereset-platform', 5, 'stop', ROSS, false);
    await press('arca', 'arca', 20, 'send-back', FOUNDER, false);
    await press('arca', 'arca', 21, 'approve', JOHN, true);

    const got = await store.collect(['arca', 'the-reset'], ROOM);
    expect(got.presses.map((p) => [p.ventureId, p.number, p.action])).toEqual([
      ['the-reset', 5, 'stop'], ['arca', 20, 'send-back'], ['arca', 21, 'approve'],
    ]);
    expect(got.signOffs.map((p) => [p.number, p.action, p.by])).toEqual([[21, 'accept', FOUNDER]]);
    expect(got.more).toBe(false);
    expect(got.presses.every((p) => p.collectedAt)).toBe(true);

    expect(await store.collect(['arca', 'the-reset'], ROOM)).toEqual({ presses: [], signOffs: [], more: false });
  });

  it('only for the ventures it names', async () => {
    await press('the-reset', 'thereset-platform', 5, 'stop', ROSS, false);
    expect((await store.collect(['arca'], ROOM)).presses).toEqual([]);
    expect((await store.collect(['the-reset'], ROOM)).presses).toHaveLength(1);
  });

  it('no more than fits; the rest wait for the next collect, and none is lost', async () => {
    await press('arca', 'arca', 20, 'stop', FOUNDER, false);
    await press('arca', 'arca', 21, 'stop', FOUNDER, false);
    await press('the-reset', 'thereset-platform', 5, 'stop', ROSS, false);
    const one = await store.collect(['arca', 'the-reset'], { ...ROOM, limit: 2 });
    expect([one.presses.length, one.more]).toEqual([2, true]);
    const two = await store.collect(['arca', 'the-reset'], { ...ROOM, limit: 2 });
    expect([two.presses.length, two.more]).toEqual([1, false]);
    expect(new Set([...one.presses, ...two.presses].map((p) => p.number))).toEqual(new Set([20, 21, 5]));
  });
});

describe("the box's answer", () => {
  it('is kept once; the same again is fine, a different one is not', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    const [p] = (await store.collect(['arca', 'the-reset'], ROOM)).presses;
    expect(await store.answer(['arca', 'the-reset'], p.id, 'done', 'Made part of ARCA.')).toBe('stored');
    expect(await store.answer(['arca', 'the-reset'], p.id, 'done', 'Made part of ARCA.')).toBe('same');
    expect(await store.answer(['arca', 'the-reset'], p.id, 'refused', 'No.')).toBe('different');
    expect((await store.presses('arca', 'arca', 21))[0].answer).toMatchObject({ outcome: 'done', message: 'Made part of ARCA.' });
  });

  it('is not taken for a sign-off, or for a press that is not there', async () => {
    await press('arca', 'arca', 21, 'accept', FOUNDER, false);
    const [s] = await store.presses('arca', 'arca', 21);
    expect(await store.answer(['arca'], s.id, 'done', 'x')).toBe('sign-off');
    expect(await store.answer(['arca'], '00000000-0000-4000-8000-000000000000', 'done', 'x')).toBe('no-press');
  });
});

describe('a tap on Telegram', () => {
  const tap = { repo: 'arca', number: 21, action: 'reject' as const, at: '2026-11-04T08:00:00.000Z', by: JOHN, outcome: 'done' as const, message: 'Rejected on Telegram.' };

  it('is kept as a press of its own, already answered, and never collected', async () => {
    expect(await store.telegram('arca', tap)).toBe('stored');
    const [p] = await store.presses('arca', 'arca', 21);
    expect(p).toMatchObject({ source: 'telegram', action: 'reject', byJohn: true, answer: { outcome: 'done' } });
    expect((await store.collect(['arca'], ROOM)).presses).toEqual([]);
  });

  it('reported twice is one press; reported with another answer is refused', async () => {
    await store.telegram('arca', tap);
    expect(await store.telegram('arca', tap)).toBe('same');
    expect(await store.telegram('arca', { ...tap, outcome: 'refused' })).toBe('different');
    expect(await store.presses('arca', 'arca', 21)).toHaveLength(1);
  });

  it('settles the card for the studio, and is kept even while a studio press is waiting', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    expect(await store.telegram('arca', tap)).toBe('stored');
    expect(await store.presses('arca', 'arca', 21)).toHaveLength(2);
    expect(await press('arca', 'arca', 21, 'stop', FOUNDER, false)).toBe('out-of-date');
  });

  it('for a card that is not here, or not this venture’s, is refused', async () => {
    expect(await store.telegram('arca', { ...tap, repo: 'thereset-platform', number: 5 })).toBe('no-card');
  });
});

it('the statements name no venture except through the scope', () => {
  for (const sql of Object.values(PRESS_SQL)) expect(sql).not.toMatch(/venture_id\s*=\s*\$/);
});

describe('a press the box never answers (FB-278)', () => {
  /** Move a press's times back, as the owner: the studio's role may not change when it was pressed. */
  const age = (id: string, minutes: { pressed: number; collected?: number }) => asOwner(() => db.query(
    `update factorystore.presses set pressed_at = now() - make_interval(mins => $2),
            collected_at = case when $3::int is null then null else now() - make_interval(mins => $3::int) end
      where id = $1`,
    [id, minutes.pressed, minutes.collected ?? null],
  ));
  const only = async () => (await store.presses('arca', 'arca', 21))[0];

  it('still stands for 10 minutes, collected or not', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    await age((await only()).id, { pressed: 9 });
    expect(await press('arca', 'arca', 21, 'reject', JOHN, true)).toBe('out-of-date');
    await age((await only()).id, { pressed: 30, collected: 9 });
    expect(await press('arca', 'arca', 21, 'reject', JOHN, true)).toBe('out-of-date');
  });

  it('left uncollected for 10 minutes, it is never handed to the box, and a new press is recorded', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    const first = await only();
    await age(first.id, { pressed: 11 });
    expect((await store.collect(['arca'], ROOM)).presses).toEqual([]);

    expect(await press('arca', 'arca', 21, 'reject', JOHN, true)).toBe('recorded');
    expect((await store.collect(['arca'], ROOM)).presses.map((p) => p.action)).toEqual(['reject']);
    const lapsed = await scoped('arca', (q) => q.query<{ lapsed: boolean }>('select lapsed_at is not null as lapsed from factorystore.presses where id = $1', [first.id]));
    expect(lapsed.rows[0].lapsed).toBe(true);
  });

  it('collected and unanswered for 10 minutes, a new press is recorded, and a late answer is still kept', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    const [first] = (await store.collect(['arca'], ROOM)).presses;
    await age(first.id, { pressed: 30, collected: 11 });

    expect(await press('arca', 'arca', 21, 'try-again', JOHN, true)).toBe('recorded');
    expect(await store.answer(['arca'], first.id, 'done', 'Made part of ARCA.')).toBe('stored');
    expect((await store.presses('arca', 'arca', 21)).map((p) => [p.action, p.answer?.outcome ?? null])).toEqual([['approve', 'done'], ['try-again', null]]);
    // The box did it after all: the card is settled, and nothing more can be pressed.
    expect(await press('arca', 'arca', 21, 'stop', JOHN, true)).toBe('out-of-date');
  });

  it('a late "done" on a lapsed press is kept even when the press after it was done too, and the card shows the later', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    const [first] = (await store.collect(['arca'], ROOM)).presses;
    await age(first.id, { pressed: 30, collected: 11 });
    expect(await press('arca', 'arca', 21, 'try-again', JOHN, true)).toBe('recorded');
    const [second] = (await store.collect(['arca'], ROOM)).presses;
    expect(await store.answer(['arca'], second.id, 'done', 'Building it again.')).toBe('stored');

    // The box crashed after doing the first, and says so once it is back. What it did is kept.
    expect(await store.answer(['arca'], first.id, 'done', 'Made part of ARCA.')).toBe('stored');
    const all = await store.presses('arca', 'arca', 21);
    expect(all.map((p) => p.answer?.outcome)).toEqual(['done', 'done']);
    expect(stateFrom(all, Date.now())).toMatchObject({ kind: 'decided', action: 'try-again' });
    expect(await press('arca', 'arca', 21, 'stop', JOHN, true)).toBe('out-of-date');
  });

  it('a sign-off never lapses: it is collected however late', async () => {
    await press('arca', 'arca', 21, 'accept', FOUNDER, false);
    await age((await only()).id, { pressed: 60 });
    expect((await store.collect(['arca'], ROOM)).signOffs.map((p) => p.action)).toEqual(['accept']);
  });

  it('the database still refuses two presses standing at once', async () => {
    await press('arca', 'arca', 21, 'approve', JOHN, true);
    await age((await only()).id, { pressed: 11 });
    // A press the studio did not mark lapsed still counts, so the second wall holds.
    await expect(scoped('arca', (q) => q.query(
      "insert into factorystore.presses (venture_id, repo, number, action, by_email, by_john, seen_head_sha) values ('arca', 'arca', 21, 'stop', $1, false, 'sha-arca-21')",
      [FOUNDER],
    ))).rejects.toThrow(/presses_one_standing/);
  });
});
