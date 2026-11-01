import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { SQL, sqlCardStore, type CardStore, type Querier } from '../card-store';
import { PRESS_SQL } from '../press-store';
import { loadReview } from '../review-load';
import type { VentureSummary } from '../ventures';
import { putTestCards, storedCard, testPng } from './review-fixtures';

/**
 * FB-275: the card store, against real Postgres, connected as the studio's own role.
 *
 * The store's own statements (`SQL` in lib/card-store.ts) run here, through `sqlCardStore`, inside
 * a transaction scoped to one venture exactly as `withVenture` scopes it. What is proven is the
 * database's rule, not the code's: a connection scoped to ARCA cannot read, add or change THE
 * RESET's cards or pictures, whatever it asks for.
 */

const SCHEMA = ['001_read_model.sql', '008_factory_cards.sql', '009_factory_presses.sql', '010_press_lapses.sql'].map((f) => readFileSync(join(process.cwd(), 'db', f), 'utf8'));

const ARCA = { id: 'arca', name: 'ARCA', repos: ['arca', 'arca-marketing'], departments: [], founderEmail: 'arca.founder@bruntsfield.capital' } as unknown as VentureSummary;
const RESET = { id: 'the-reset', name: 'THE RESET', repos: ['thereset-platform'], departments: [], founderEmail: 'ross@bruntsfield.capital' } as unknown as VentureSummary;
// No live preview check, and no presses file: the test rig's answers.
const RIG = { E2E_TEST_LOGIN: '1', PRS_FIXTURE_DIR: 'none' };

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

const picture = (w: number, h: number) => testPng(w, h);
const afterPhone = (headSha: string, bytes = picture(393, 851)) => ({ name: 'after-phone' as const, headSha, width: 393, height: 851, takenAt: '2026-07-21T09:15:00.000Z', bytes });

beforeAll(async () => {
  db = await PGlite.create();
  for (const file of SCHEMA) await db.exec(file);
  // PGlite connects as a superuser, which row-level security never binds. The studio's role is.
  await db.exec('set role foundry_studio');
  store = sqlCardStore({ asVenture: (id, fn) => scoped(id, fn), asNobody: (fn) => scoped(null, fn) });
  await putTestCards(store);
  await store.putPicture('arca', 'arca', 21, afterPhone('sha-arca-21'));
  await store.putPicture('the-reset', 'thereset-platform', 5, afterPhone('sha-thereset-platform-5'));
});

afterAll(async () => {
  await db.close();
});

describe('the schema', () => {
  it('loads a second time without changing anything', async () => {
    await db.exec('reset role');
    try {
      await db.exec(SCHEMA[1]);
    } finally {
      await db.exec('set role foundry_studio');
    }
    expect((await store.card('arca', 'arca', 21))?.pictures).toHaveLength(1);
  });

  it("is bound by row-level security for the studio's role", async () => {
    const who = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    expect(who.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe("one venture cannot reach another's cards", () => {
  it("ARCA's scope reads ARCA's card, and nothing of THE RESET's, by any key", async () => {
    expect((await store.card('arca', 'arca', 21))?.plain.title).toBe('Prices in pounds for every collector');
    expect(await store.card('arca', 'thereset-platform', 5)).toBeNull();
    expect(await store.picture('arca', 'thereset-platform', 5, 'after-phone')).toBeNull();
    expect(await store.finished('arca', ['arca', 'thereset-platform'])).toEqual(
      expect.not.arrayContaining([{ repo: 'thereset-platform', number: 5 }]),
    );
    // And the raw tables, read in full, show only ARCA's rows.
    const rows = await scoped('arca', (q) => q.query<{ venture_id: string }>('select venture_id from factorystore.cards union all select venture_id from factorystore.pictures'));
    expect(new Set(rows.rows.map((r) => r.venture_id))).toEqual(new Set(['arca']));
  });

  it('no scope at all sees no card and no picture', async () => {
    const rows = await scoped(null, (q) => q.query('select 1 from factorystore.cards union all select 1 from factorystore.pictures'));
    expect(rows.rows).toEqual([]);
  });

  it("ARCA's scope cannot write a card or a picture under THE RESET", async () => {
    await expect(scoped('arca', (q) => q.query(
      "insert into factorystore.cards (venture_id, repo, number, state, sent_at, plain) values ('the-reset', 'thereset-platform', 6, 'finished', now(), '{}')",
    ))).rejects.toThrow(/row-level security/);
    await expect(scoped('arca', (q) => q.query(
      "insert into factorystore.pictures (venture_id, repo, number, name, head_sha, width, height, taken_at, bytes) values ('the-reset', 'thereset-platform', 5, 'before-phone', 'x', 1, 1, now(), '\\x89')",
    ))).rejects.toThrow(/row-level security|foreign key/);
  });

  it("ARCA's scope cannot change THE RESET's card or picture", async () => {
    expect(await store.putPreview('arca', 'thereset-platform', 5, 'https://evil.up.railway.app')).toBe('no-card');
    expect(await store.putPicture('arca', 'thereset-platform', 5, afterPhone('sha-thereset-platform-5', picture(1, 1)))).toBe('no-card');
    await scoped('arca', (q) => q.query("update factorystore.cards set state = 'done' where repo = 'thereset-platform'"));
    await scoped('arca', (q) => q.query("delete from factorystore.pictures where repo = 'thereset-platform'"));
    expect((await store.card('the-reset', 'thereset-platform', 5))?.state).toBe('finished');
    expect((await store.card('the-reset', 'thereset-platform', 5))?.previewUrl).toBeNull();
    expect((await store.picture('the-reset', 'thereset-platform', 5, 'after-phone'))?.byteLength).toBeGreaterThan(100);
  });

  it('the same repository and number under two ventures are two cards, each seen only by its own', async () => {
    await store.putCard('the-reset', { ...storedCard('arca', 20), plain: { ...storedCard('arca', 20).plain, title: 'Not ARCA\'s' } });
    expect((await store.card('arca', 'arca', 20))?.plain.title).toBe('The auctions view');
    expect((await store.card('the-reset', 'arca', 20))?.plain.title).toBe('Not ARCA\'s');
  });

  it('the studio may not delete a card', async () => {
    await expect(scoped('arca', (q) => q.query('delete from factorystore.cards'))).rejects.toThrow(/permission denied/);
  });
});

describe('the store keeps what the door hands it', () => {
  it('a picture comes back byte for byte', async () => {
    const bytes = picture(1440, 1000);
    await store.putPicture('arca', 'arca', 21, { ...afterPhone('sha-arca-21', bytes), name: 'after-computer', width: 1440, height: 1000 });
    expect(Buffer.from((await store.picture('arca', 'arca', 21, 'after-computer'))!).equals(Buffer.from(bytes))).toBe(true);
  });

  it('an older card arriving late changes nothing; a newer one replaces it and drops pictures of the old version', async () => {
    const old = storedCard('arca', 21);
    expect(await store.putCard('arca', { ...old, sentAt: '2026-01-01T00:00:00.000Z', state: 'stuck' })).toBe('older');
    expect((await store.card('arca', 'arca', 21))?.state).toBe('finished');

    await store.putCard('the-reset', { ...storedCard('thereset-platform', 5), headSha: 'sha-new', sentAt: '2026-08-01T00:00:00.000Z', plain: { ...storedCard('thereset-platform', 5).plain, headSha: 'sha-new' } });
    const reset = await store.card('the-reset', 'thereset-platform', 5);
    expect(reset?.headSha).toBe('sha-new');
    expect(reset?.pictures).toEqual([]);
    // Its preview address, sent earlier on its own, survives a new card that does not repeat it.
    await store.putPreview('the-reset', 'thereset-platform', 5, 'https://thereset-pr-5.up.railway.app');
    await store.putCard('the-reset', { ...storedCard('thereset-platform', 5), headSha: 'sha-new', sentAt: '2026-08-02T00:00:00.000Z', plain: { ...storedCard('thereset-platform', 5).plain, headSha: 'sha-new' } });
    expect((await store.card('the-reset', 'thereset-platform', 5))?.previewUrl).toBe('https://thereset-pr-5.up.railway.app');
  });

  it('a heartbeat belongs to no venture, and is read and written with no scope', async () => {
    await store.beat('planning-box', '2026-11-04T09:00:00.000Z');
    await store.beat('planning-box', '2026-11-04T09:01:00.000Z');
    expect(await store.lastBeat('planning-box')).toMatchObject({ box: 'planning-box', reportedAt: '2026-11-04T09:01:00.000Z' });
  });

  it('the statements name no venture except through the scope', () => {
    for (const sql of [...Object.values(SQL), ...Object.values(PRESS_SQL)]) expect(sql).not.toMatch(/venture_id\s*=\s*\$/);
  });
});

describe('the Review screen, from the store', () => {
  const founder = { email: 'arca.founder@bruntsfield.capital', isJohn: false, admins: ['john.gallagher@wealthcx.com'] };

  it("ARCA's founder gets ARCA's card, with the pictures the box sent and none of John's parts", async () => {
    const view = await loadReview(ARCA, 'arca', 21, founder, store, RIG);
    expect(view?.title).toBe('Prices in pounds for every collector');
    expect(view?.pictures.map((p) => [p.name, p.width, p.height])).toEqual([['after-computer', 1440, 1000], ['after-phone', 393, 851]]);
    expect(view?.forJohn).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/\$\s?\d|what to do next|archon/i);
    expect(view?.place).toEqual({ index: 2, of: 2, next: '/venture/arca/review/arca/20' });
  });

  it("THE RESET's card, asked for under ARCA, is the same nothing as a card that does not exist", async () => {
    const theirs = await loadReview(ARCA, 'thereset-platform', 5, founder, store, RIG);
    const missing = await loadReview(ARCA, 'arca', 999, founder, store, RIG);
    expect(theirs).toBeNull();
    expect(missing).toBeNull();
    // Even with the repository check taken away, the database itself hands nothing over.
    const pretending = { ...ARCA, repos: [...ARCA.repos, 'thereset-platform'] } as VentureSummary;
    expect(await loadReview(pretending, 'thereset-platform', 5, founder, store, RIG)).toBeNull();
  });

  it('a card the factory has since marked done has no Review screen', async () => {
    await store.putCard('arca', { ...storedCard('arca', 20), state: 'done', sentAt: '2026-12-01T00:00:00.000Z' });
    expect(await loadReview(ARCA, 'arca', 20, founder, store, RIG)).toBeNull();
    expect((await loadReview(ARCA, 'arca', 21, founder, store, RIG))?.place).toEqual({ index: 1, of: 1, next: null });
  });

  it("John sees his parts on THE RESET's card", async () => {
    const view = await loadReview(RESET, 'thereset-platform', 5, { email: 'john.gallagher@wealthcx.com', isJohn: true, admins: ['john.gallagher@wealthcx.com'] }, store, RIG);
    expect(view?.forJohn).toEqual({ cost: '$1.20', nextStep: 'What to do next: wait for Ross.', runUrl: 'https://archon.example.invalid/runs/thereset-5' });
  });
});

describe("a venture's newest cards, for the lists (FB-277)", () => {
  it('come newest first, with the presses on the version each is about, and only that venture\'s', async () => {
    await store.putCard('arca', { ...storedCard('arca', 22), sentAt: '2026-12-02T00:00:00.000Z' });
    await store.press('arca', { repo: 'arca', number: 21, action: 'accept', by: 'arca.founder@bruntsfield.capital', byJohn: false, note: '', seenHeadSha: null });
    const got = await store.newest('arca', 50);
    expect(got.map((c) => `${c.card.repo}#${c.card.number}`)).toEqual(['arca#22', 'arca#20', 'arca#21']);
    expect(got.find((c) => c.card.number === 21)?.presses.map((p) => p.action)).toEqual(['accept']);
    expect(got.find((c) => c.card.number === 22)?.presses).toEqual([]);
    expect(got.every((c) => c.card.repo === 'arca')).toBe(true);
    expect((await store.newest('arca', 1)).map((c) => c.card.number)).toEqual([22]);
    expect((await store.newest('the-reset', 50)).map((c) => `${c.card.repo}#${c.card.number}`)).not.toContain('arca#22');
  });

  it('read nothing with no scope', async () => {
    expect(await scoped(null, (q) => q.query(SQL.newest, [50]))).toMatchObject({ rows: [] });
    expect(await scoped(null, (q) => q.query(PRESS_SQL.onNewest, [50]))).toMatchObject({ rows: [] });
  });
});

describe("the factory's own cards, under _factory (FB-277)", () => {
  const cowgate = () => ({ ...storedCard('cowgate', 40), repo: 'cowgate' });

  beforeAll(async () => {
    await store.putCard('_factory', cowgate());
  });

  it('are kept and read under _factory alone', async () => {
    expect((await store.card('_factory', 'cowgate', 40))?.plain.title).toBe("The listener's second inbox");
    expect((await store.newest('_factory', 50)).map((c) => c.card.repo)).toEqual(['cowgate']);
  });

  it("no venture's scope can list, open or press one, by any key", async () => {
    for (const v of ['arca', 'the-reset']) {
      expect(await store.card(v, 'cowgate', 40)).toBeNull();
      expect((await store.newest(v, 500)).some((c) => c.card.repo === 'cowgate')).toBe(false);
      expect(await store.press(v, { repo: 'cowgate', number: 40, action: 'stop', by: 'arca.founder@bruntsfield.capital', byJohn: false, note: '', seenHeadSha: null })).toBe('no-card');
      const raw = await scoped(v, (q) => q.query<{ venture_id: string }>("select venture_id from factorystore.cards where repo = 'cowgate' union all select venture_id from factorystore.presses where repo = 'cowgate'"));
      expect(raw.rows).toEqual([]);
    }
    expect(await store.presses('_factory', 'cowgate', 40)).toEqual([]);
  });

  it("a venture's scope cannot write under _factory, and _factory's cannot write under a venture", async () => {
    await expect(scoped('arca', (q) => q.query(
      "insert into factorystore.cards (venture_id, repo, number, state, sent_at, plain) values ('_factory', 'cowgate', 41, 'finished', now(), '{}')",
    ))).rejects.toThrow(/row-level security/);
    await expect(scoped('_factory', (q) => q.query(
      "insert into factorystore.cards (venture_id, repo, number, state, sent_at, plain) values ('arca', 'arca', 41, 'finished', now(), '{}')",
    ))).rejects.toThrow(/row-level security/);
    // And _factory's scope sees no venture's cards.
    const raw = await scoped('_factory', (q) => q.query<{ venture_id: string }>('select distinct venture_id from factorystore.cards'));
    expect(raw.rows).toEqual([{ venture_id: '_factory' }]);
  });
});
