import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryCardStore, type CardStore } from '../card-store';
import { CHANGED, NOT_FOUND, ONLY_JOHN, pressCard, type PressDeps, type Presser } from '../press';
import { OUT_OF_DATE } from '../review';
import type { VentureSummary } from '../ventures';
import { putTestCards, storedCard } from './review-fixtures';

/**
 * FB-276: the studio's side of a press on a factory card (`lib/press.ts`), against the rig's store.
 *
 * Who may press what, the first press wins, a refused press is never recorded, and another
 * venture's card is answered as a missing one. The same rules against real Postgres are in
 * `press-store.test.ts`; the session and venture checks before these are in the server action.
 */

const ARCA = { id: 'arca', name: 'ARCA', repos: ['arca'], departments: [], founderEmail: 'arca.founder@bruntsfield.capital' } as unknown as VentureSummary;
const FOUNDER: Presser = { email: 'arca.founder@bruntsfield.capital', isJohn: false };
const JOHN: Presser = { email: 'john.gallagher@wealthcx.com', isJohn: true };

let store: CardStore;
let logged: string[];
let state: string;
let deps: PressDeps;

beforeEach(async () => {
  store = memoryCardStore();
  await putTestCards(store);
  logged = [];
  state = mkdtempSync(join(tmpdir(), 'fb276-'));
  deps = { store, recordFile: join(state, 'presses.jsonl'), log: (l) => logged.push(l), now: () => new Date('2026-11-04T09:00:00Z') };
});

afterEach(() => rmSync(state, { recursive: true, force: true }));

const lines = () => (existsSync(deps.recordFile!) ? readFileSync(deps.recordFile!, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const on21 = () => store.presses('arca', 'arca', 21);
const press = (who: Presser, action: string, opts: { note?: string; seenHeadSha?: string } = {}, number = 21) =>
  pressCard(deps, ARCA, who, 'arca', number, action, opts);

describe('who may press what', () => {
  it.each(['stop', 'send-back', 'accept'])('a founder may press %s on their own card', async (action) => {
    const r = await press(FOUNDER, action, { note: 'Shorter, please.' });
    expect(r.ok).toBe(true);
    expect((await on21()).map((p) => [p.action, p.byJohn])).toEqual([[action, false]]);
  });

  it.each(['approve', 'reject', 'try-again', 'split'])("a founder's %s is refused, logged, and never recorded", async (action) => {
    const r = await press(FOUNDER, action);
    expect(r).toEqual({ ok: false, message: ONLY_JOHN });
    expect(await on21()).toEqual([]);
    expect(lines()).toEqual([]);
    expect(await store.collect(['arca'], { limit: 20, bytes: 60_000, size: () => 1 })).toMatchObject({ presses: [], signOffs: [] });
    expect(logged).toEqual([`refused: ${FOUNDER.email} pressed ${action} on arca arca#21, which only John may press. Nothing was recorded.`]);
  });

  it.each(['approve', 'reject', 'try-again', 'split', 'stop', 'send-back'])('John may press %s', async (action) => {
    expect((await press(JOHN, action, { note: 'Try the other layout.' })).ok).toBe(true);
    expect((await on21()).map((p) => [p.action, p.byJohn])).toEqual([[action, true]]);
  });

  it("John's Accept is his Approve: he has no sign-off to give", async () => {
    const r = await press(JOHN, 'accept');
    expect(r.signedOff).toBeUndefined();
    expect((await on21()).map((p) => p.action)).toEqual(['approve']);
  });

  it('a press the studio does not know is refused, and nothing is recorded', async () => {
    expect((await press(JOHN, 'merge')).ok).toBe(false);
    expect((await press(JOHN, 'Approve')).ok).toBe(false);
    expect(await on21()).toEqual([]);
  });

  it('Send back needs a note, and a note has a limit', async () => {
    expect((await press(FOUNDER, 'send-back', { note: '  ' })).ok).toBe(false);
    expect((await press(FOUNDER, 'send-back', { note: 'x'.repeat(2001) })).ok).toBe(false);
    expect(await on21()).toEqual([]);
  });
});

describe("another venture's card", () => {
  it("is answered exactly as a missing card is, before anyone's role is looked at", async () => {
    // THE RESET's card is kept under THE RESET. Under ARCA's scope it is not there at all.
    const theirs = await pressCard(deps, { ...ARCA, repos: ['arca', 'thereset-platform'] } as VentureSummary, FOUNDER, 'thereset-platform', 5, 'approve');
    const missing = await press(FOUNDER, 'approve', {}, 999);
    expect(theirs).toEqual({ ok: false, message: NOT_FOUND });
    expect(missing).toEqual(theirs);
    expect(await store.presses('the-reset', 'thereset-platform', 5)).toEqual([]);
    expect(logged).toEqual([]);
  });
});

describe('the first press wins', () => {
  it('a second settling press is out of date, and records nothing', async () => {
    expect((await press(JOHN, 'approve')).ok).toBe(true);
    expect(await press(JOHN, 'approve')).toEqual({ ok: false, message: OUT_OF_DATE });
    expect(await press(FOUNDER, 'send-back', { note: 'Wait' })).toEqual({ ok: false, message: OUT_OF_DATE });
    expect(await press(FOUNDER, 'accept')).toEqual({ ok: false, message: OUT_OF_DATE });
    expect((await on21()).map((p) => p.action)).toEqual(['approve']);
    expect(lines().map((l) => l.decision)).toEqual(['approved']);
  });

  it('two presses at the same moment: exactly one is recorded', async () => {
    const [a, b] = await Promise.all([press(JOHN, 'approve'), press(FOUNDER, 'stop')]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await on21()).toHaveLength(1);
  });

  it("a founder's sign-off does not settle the card; John's Approve after it does", async () => {
    expect(await press(FOUNDER, 'accept', { note: 'Lovely.' })).toMatchObject({ ok: true, signedOff: true });
    expect(await press(FOUNDER, 'accept')).toMatchObject({ ok: true, signedOff: true, message: 'You have already signed this off. It is waiting for John.' });
    expect((await press(JOHN, 'accept')).ok).toBe(true);
    expect((await on21()).map((p) => p.action)).toEqual(['accept', 'approve']);
    expect(lines().map((l) => l.decision)).toEqual(['signed-off', 'approved']);
  });

  it('a press the box said did nothing no longer stands', async () => {
    await press(JOHN, 'approve');
    const [first] = await on21();
    expect(await store.answer(['arca'], first.id, 'out-of-date', 'The run had moved on. Nothing was done.')).toBe('stored');
    expect((await press(JOHN, 'try-again')).ok).toBe(true);
  });

  it('a press the box said it did still stands', async () => {
    await press(JOHN, 'approve');
    const [first] = await on21();
    await store.answer(['arca'], first.id, 'done', 'Made part of ARCA.');
    expect(await press(JOHN, 'approve')).toEqual({ ok: false, message: OUT_OF_DATE });
  });

  it('a tap on Telegram settles the card here too', async () => {
    await store.telegram('arca', { repo: 'arca', number: 21, action: 'reject', at: '2026-11-04T08:00:00.000Z', by: JOHN.email, outcome: 'done', message: 'Rejected on Telegram.' });
    expect(await press(FOUNDER, 'accept')).toEqual({ ok: false, message: OUT_OF_DATE });
  });

  it('a new version of the work needs a new decision', async () => {
    await press(JOHN, 'approve');
    await store.putCard('arca', { ...storedCard('arca', 21), headSha: 'sha-arca-21-again', sentAt: '2026-08-01T00:00:00.000Z' });
    expect(await on21()).toEqual([]);
    expect((await press(FOUNDER, 'accept', { seenHeadSha: 'sha-arca-21-again' })).ok).toBe(true);
  });
});

describe('the version the person was shown', () => {
  it('must still be the card’s, or nothing is done', async () => {
    expect(await press(FOUNDER, 'accept', { seenHeadSha: 'sha-something-older' })).toEqual({ ok: false, message: CHANGED });
    expect(await on21()).toEqual([]);
    expect((await press(FOUNDER, 'accept', { seenHeadSha: 'sha-arca-21' })).ok).toBe(true);
    expect((await on21())[0].seenHeadSha).toBe('sha-arca-21');
  });
});

describe("the test copy's line file", () => {
  it('is written once per recorded press, with the note in full', async () => {
    await press(FOUNDER, 'send-back', { note: '1. On the "after" picture, on a phone, 80% across and 40% down: The button is cut off here' });
    expect(lines()).toEqual([expect.objectContaining({
      venture: 'arca', repo: 'arca', number: 21, by: FOUNDER.email, decision: 'sent-back',
      note: '1. On the "after" picture, on a phone, 80% across and 40% down: The button is cut off here',
    })]);
  });

  it('is not written outside the test rig', async () => {
    deps = { ...deps, recordFile: null };
    await press(FOUNDER, 'accept');
    expect(existsSync(join(state, 'presses.jsonl'))).toBe(false);
    expect(await on21()).toHaveLength(1);
  });
});

describe('when the factory goes quiet (FB-278)', () => {
  let clock: number;
  const at = (iso: string) => { clock = Date.parse(iso); };
  const pressAt = (who: Presser, action: string) => pressCard({ ...deps, store, now: () => new Date(clock) }, ARCA, who, 'arca', 21, action, { note: 'Shorter.' });
  const ROOM = { limit: 20, bytes: 60_000, size: () => 1 };

  beforeEach(async () => {
    at('2026-11-04T09:00:00Z');
    store = memoryCardStore(() => new Date(clock));
    await putTestCards(store);
  });

  it('a box never heard from has not gone quiet: presses are recorded', async () => {
    expect((await pressAt(JOHN, 'approve')).ok).toBe(true);
  });

  it('after five minutes of silence nothing is recorded, and the press says why; when it reports again, presses come back', async () => {
    await store.beat('planning-box', '2026-11-04T08:55:59Z');
    at('2026-11-04T09:01:00Z');
    expect(await pressAt(JOHN, 'approve')).toEqual({
      ok: false,
      message: "The factory hasn't reported since 08:55, so nothing was recorded. Try again once it is back.",
    });
    expect(await pressAt(FOUNDER, 'accept')).toMatchObject({ ok: false });
    expect(await on21()).toEqual([]);
    expect(lines()).toEqual([]);

    await store.beat('planning-box', '2026-11-04T09:01:00Z');
    expect((await pressAt(JOHN, 'approve')).ok).toBe(true);
  });

  it('a press left uncollected for 10 minutes is never collected, and no longer blocks a new one', async () => {
    expect((await pressAt(JOHN, 'approve')).ok).toBe(true);
    at('2026-11-04T09:09:59Z');
    expect(await pressAt(JOHN, 'reject')).toEqual({ ok: false, message: OUT_OF_DATE });
    at('2026-11-04T09:10:00Z');
    expect((await store.collect(['arca'], ROOM)).presses).toEqual([]);
    expect((await pressAt(JOHN, 'reject')).ok).toBe(true);
    expect((await store.collect(['arca'], ROOM)).presses.map((p) => p.action)).toEqual(['reject']);
  });

  it('a press collected and unanswered for 10 minutes no longer blocks a new one; a late answer is kept', async () => {
    expect((await pressAt(JOHN, 'approve')).ok).toBe(true);
    at('2026-11-04T09:05:00Z');
    const [first] = (await store.collect(['arca'], ROOM)).presses;
    at('2026-11-04T09:14:59Z');
    expect(await pressAt(JOHN, 'reject')).toEqual({ ok: false, message: OUT_OF_DATE });
    at('2026-11-04T09:15:00Z');
    expect((await pressAt(JOHN, 'reject')).ok).toBe(true);
    expect(await store.answer(['arca'], first.id, 'done', 'Made part of ARCA.')).toBe('stored');
  });
});
