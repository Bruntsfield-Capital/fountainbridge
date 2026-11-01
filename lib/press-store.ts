import { randomUUID } from 'node:crypto';
import {
  LAPSE_MS, hasLapsed, stands,
  type NewPress, type Outcome, type PressAction, type PressKept, type StoredPress, type TelegramPress,
} from './presses';

/**
 * The presses on the factory's cards, as the studio keeps them (FB-276, `db/009_factory_presses.sql`).
 *
 * Part of the card store (`lib/card-store.ts`): a press belongs to a card, and is kept beside it,
 * under the same venture. As there, every call that names one venture runs inside `withVenture`, and
 * no statement below names a venture except through the connection's own scope.
 *
 * The box's calls (`collect`, `answer`) name every venture in the manifests. They ask each venture
 * in turn, each inside its own scope, and put the answers together here. Nothing reads two
 * ventures' presses in one scope, because there is no scope that could.
 *
 * The statements are exported so the tests run THESE strings against real Postgres.
 */

export interface PressStore {
  /**
   * Record one press on a card, unless a press already stands on it. The checks and the write are one
   * transaction, with the card's row locked, so two presses at once cannot both be recorded.
   */
  press(ventureId: string, press: NewPress): Promise<PressKept>;
  /** Every press on the version of the work the card is about now, oldest first. */
  presses(ventureId: string, repo: string, number: number): Promise<StoredPress[]>;
  /**
   * For the box: the presses it has not collected, oldest first, and the founders' sign-offs
   * separately. Each is handed out once: what is returned is marked collected.
   */
  collect(ventureIds: string[], room: Room): Promise<{ presses: StoredPress[]; signOffs: StoredPress[]; more: boolean }>;
  /** For the box: what happened to one press. The same answer twice is fine; a different one is not. */
  answer(ventureIds: string[], id: string, outcome: Outcome, message: string): Promise<'stored' | 'same' | 'different' | 'no-press' | 'sign-off'>;
  /** For the box: a tap on Telegram, kept as a press of its own so the studio's card shows it. */
  telegram(ventureId: string, tap: TelegramPress): Promise<'stored' | 'same' | 'different' | 'no-card'>;
}

/**
 * How much one collect may hand out: at most `limit` of each list, and at most `bytes` in all, as
 * `size` measures each press. Presses take their room first; sign-offs get what is left. The oldest
 * press always goes, even alone over `bytes`, so the box is never stuck behind one long note.
 */
export interface Room {
  limit: number;
  bytes: number;
  size: (p: StoredPress) => number;
}

/** The oldest that fit in the room, and how much room they took. */
function choose(waiting: StoredPress[], limit: number, bytes: number, size: Room['size'], alwaysOne: boolean): { chosen: StoredPress[]; used: number } {
  const chosen: StoredPress[] = [];
  let used = 0;
  for (const p of [...waiting].sort(oldestFirst)) {
    const n = size(p);
    if (chosen.length >= limit || ((chosen.length > 0 || !alwaysOne) && used + n > bytes)) break;
    chosen.push(p);
    used += n;
  }
  return { chosen, used };
}

/** Anything with pg's `query(text, params)` shape. */
interface Querier {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

const COLUMNS = `id, venture_id, repo, number, action, by_email, by_john, source, note, seen_head_sha,
                 pressed_at, collected_at, outcome, message, answered_at`;

export const PRESS_SQL = {
  // Locked until the transaction ends, so a second press on this card waits here for the first.
  lockCard: 'select head_sha from factorystore.cards where repo = $1 and number = $2 for update',
  // `stands` in lib/presses.ts, in SQL: a settling press the box did, or one it has not answered
  // and that has not lapsed (FB-278, `LAPSE_MS`).
  standing: `select 1 from factorystore.presses
              where repo = $1 and number = $2 and seen_head_sha = $3 and action <> 'accept'
                and (outcome = 'done'
                     or (outcome is null and lapsed_at is null
                         and coalesce(collected_at, pressed_at) > now() - make_interval(secs => $4)))
              limit 1`,
  // Run just before a new press is written, once `standing` found none: any unanswered press left on
  // the card has lapsed. Marked so `presses_one_standing` no longer counts it. Not an answer: the
  // box's answer may still come, and the card shows it.
  lapse: `update factorystore.presses set lapsed_at = now()
           where repo = $1 and number = $2 and seen_head_sha = $3 and source = 'studio'
             and action <> 'accept' and outcome is null and lapsed_at is null`,
  signedOff: `select 1 from factorystore.presses
               where repo = $1 and number = $2 and seen_head_sha = $3 and action = 'accept' and by_email = $4
               limit 1`,
  // `on conflict do nothing`: if the unique indexes catch what the checks above did not, nothing
  // comes back, and the press is out of date.
  insert: `insert into factorystore.presses (venture_id, repo, number, action, by_email, by_john, note, seen_head_sha)
           values (current_setting('app.venture_id', true), $1, $2, $3, $4, $5, $6, $7)
           on conflict do nothing
           returning id`,
  presses: `select ${COLUMNS} from factorystore.presses
             where repo = $1 and number = $2
               and seen_head_sha = (select head_sha from factorystore.cards where repo = $1 and number = $2)
             order by pressed_at, seq`,
  // A press left uncollected past `LAPSE_MS` has lapsed: the card says nothing was done, so the box
  // must never be handed it to do.
  waiting: `select ${COLUMNS} from factorystore.presses
             where collected_at is null and source = 'studio' and (action = 'accept') = $1
               and (action = 'accept' or pressed_at > now() - make_interval(secs => $3))
             order by pressed_at, seq
             limit $2`,
  markCollected: `update factorystore.presses set collected_at = now()
                   where id = any($1::uuid[]) and collected_at is null
                   returning ${COLUMNS}`,
  find: 'select action, outcome, message from factorystore.presses where id = $1',
  answer: `update factorystore.presses
              set outcome = $2, message = $3, answered_at = now(), collected_at = coalesce(collected_at, now())
            where id = $1 and outcome is null
            returning 1 as kept`,
  telegram: `insert into factorystore.presses
               (venture_id, repo, number, action, by_email, by_john, source, seen_head_sha, pressed_at,
                collected_at, outcome, message, answered_at)
             values (current_setting('app.venture_id', true), $1, $2, $3, $4, true, 'telegram', $5, $6, now(), $7, $8, now())
             on conflict do nothing
             returning 1 as kept`,
  telegramFind: `select outcome, message from factorystore.presses
                  where source = 'telegram' and repo = $1 and number = $2 and action = $3 and pressed_at = $4`,
  headOf: 'select head_sha from factorystore.cards where repo = $1 and number = $2',
  // FB-277: the presses on the newest cards of a venture, each on the version of the work its card
  // is about now. The same cards, in the same order, as `CARD_SQL.newest` reads them.
  onNewest: `select ${COLUMNS} from factorystore.presses p
              where exists (select 1 from (select repo, number, head_sha from factorystore.cards
                                            order by sent_at desc, repo, number limit $1) c
                             where c.repo = p.repo and c.number = p.number and c.head_sha = p.seen_head_sha)
              order by pressed_at, seq`,
} as const;

const LAPSE_SECONDS = LAPSE_MS / 1000;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export function pressFromRow(r: Record<string, unknown>): StoredPress {
  return {
    id: String(r.id),
    ventureId: String(r.venture_id),
    repo: String(r.repo),
    number: Number(r.number),
    action: r.action as PressAction,
    by: String(r.by_email),
    byJohn: Boolean(r.by_john),
    source: r.source === 'telegram' ? 'telegram' : 'studio',
    note: String(r.note ?? ''),
    seenHeadSha: String(r.seen_head_sha ?? ''),
    pressedAt: iso(r.pressed_at),
    collectedAt: r.collected_at ? iso(r.collected_at) : null,
    answer: r.outcome ? { outcome: r.outcome as Outcome, message: String(r.message ?? ''), at: iso(r.answered_at) } : null,
  };
}

/** By when they were pressed. The sort is stable, so presses made in the same instant keep their order. */
const oldestFirst = (a: StoredPress, b: StoredPress) => Date.parse(a.pressedAt) - Date.parse(b.pressedAt);

/**
 * The oldest that fit of what each venture has waiting, then only those marked collected. Two passes
 * so that what is marked is exactly what is handed out: nothing is marked and then dropped.
 */
async function gather(
  ventureIds: string[],
  limit: number,
  bytes: number,
  size: Room['size'],
  alwaysOne: boolean,
  peek: (ventureId: string, n: number) => Promise<StoredPress[]>,
  mark: (ventureId: string, ids: string[]) => Promise<StoredPress[]>,
): Promise<{ list: StoredPress[]; more: boolean; used: number }> {
  const seen: StoredPress[] = [];
  for (const v of ventureIds) seen.push(...(await peek(v, limit + 1)));
  const { chosen, used } = choose(seen, limit, bytes, size, alwaysOne);
  const out: StoredPress[] = [];
  for (const v of ventureIds) {
    const ids = chosen.filter((p) => p.ventureId === v).map((p) => p.id);
    if (ids.length) out.push(...(await mark(v, ids)));
  }
  return { list: out.sort(oldestFirst), more: seen.length > chosen.length, used };
}

/** The press store over the studio's database. `asVenture` is `withVenture`, one transaction each. */
export function sqlPressStore(run: { asVenture<T>(ventureId: string, fn: (q: Querier) => Promise<T>): Promise<T> }): PressStore {
  const collectOf = (signOffs: boolean, ventureIds: string[], limit: number, bytes: number, size: Room['size'], alwaysOne: boolean) =>
    gather(
      ventureIds,
      limit,
      bytes,
      size,
      alwaysOne,
      (v, n) => run.asVenture(v, async (q) => (await q.query<Record<string, unknown>>(PRESS_SQL.waiting, [signOffs, n, LAPSE_SECONDS])).rows.map(pressFromRow)),
      (v, ids) => run.asVenture(v, async (q) => (await q.query<Record<string, unknown>>(PRESS_SQL.markCollected, [ids])).rows.map(pressFromRow)),
    );

  return {
    press: (ventureId, p) =>
      run.asVenture(ventureId, async (q): Promise<PressKept> => {
        const card = (await q.query<{ head_sha: string }>(PRESS_SQL.lockCard, [p.repo, p.number])).rows[0];
        if (!card) return 'no-card';
        const head = String(card.head_sha ?? '');
        // A settled card takes no more presses, a sign-off included.
        if ((await q.query(PRESS_SQL.standing, [p.repo, p.number, head, LAPSE_SECONDS])).rows.length) return 'out-of-date';
        if (p.seenHeadSha !== null && p.seenHeadSha !== head) return 'changed';
        if (p.action === 'accept' && (await q.query(PRESS_SQL.signedOff, [p.repo, p.number, head, p.by])).rows.length) return 'already-signed-off';
        await q.query(PRESS_SQL.lapse, [p.repo, p.number, head]);
        const { rows } = await q.query(PRESS_SQL.insert, [p.repo, p.number, p.action, p.by, p.byJohn, p.note, head]);
        if (rows.length) return 'recorded';
        return p.action === 'accept' ? 'already-signed-off' : 'out-of-date';
      }),

    presses: (ventureId, repo, number) =>
      run.asVenture(ventureId, async (q) => (await q.query<Record<string, unknown>>(PRESS_SQL.presses, [repo, number])).rows.map(pressFromRow)),

    async collect(ventureIds, room) {
      const presses = await collectOf(false, ventureIds, room.limit, room.bytes, room.size, true);
      const signOffs = await collectOf(true, ventureIds, room.limit, room.bytes - presses.used, room.size, presses.list.length === 0);
      return { presses: presses.list, signOffs: signOffs.list, more: presses.more || signOffs.more };
    },

    async answer(ventureIds, id, outcome, message) {
      for (const v of ventureIds) {
        const found = await run.asVenture(v, async (q) => {
          const row = (await q.query<{ action: string; outcome: string | null; message: string | null }>(PRESS_SQL.find, [id])).rows[0];
          if (!row) return null;
          if (row.action === 'accept') return 'sign-off' as const;
          if (row.outcome === null && (await q.query(PRESS_SQL.answer, [id, outcome, message])).rows.length) return 'stored' as const;
          const now = (await q.query<{ outcome: string; message: string }>(PRESS_SQL.find, [id])).rows[0];
          return now.outcome === outcome && now.message === message ? ('same' as const) : ('different' as const);
        });
        if (found) return found;
      }
      return 'no-press';
    },

    telegram: (ventureId, t) =>
      run.asVenture(ventureId, async (q) => {
        const card = (await q.query<{ head_sha: string }>(PRESS_SQL.headOf, [t.repo, t.number])).rows[0];
        if (!card) return 'no-card' as const;
        const { rows } = await q.query(PRESS_SQL.telegram, [t.repo, t.number, t.action, t.by, String(card.head_sha ?? ''), t.at, t.outcome, t.message]);
        if (rows.length) return 'stored' as const;
        const was = (await q.query<{ outcome: string; message: string }>(PRESS_SQL.telegramFind, [t.repo, t.number, t.action, t.at])).rows[0];
        return was && was.outcome === t.outcome && was.message === t.message ? ('same' as const) : ('different' as const);
      }),
  };
}

/**
 * The same store, kept in this process's memory, for the browser tests' own studio
 * (`lib/card-store-live.ts`). `headOf` reads the card the press is on, from the memory card store.
 *
 * Every method does its checks and its write with no `await` between them, so two presses at once
 * are taken one after the other, as the database's lock takes them.
 */
export function memoryPressStore(headOf: (ventureId: string, repo: string, number: number) => string | null, now: () => Date): PressStore {
  const all: StoredPress[] = [];
  const onCard = (v: string, repo: string, number: number, head: string) =>
    all.filter((p) => p.ventureId === v && p.repo === repo && p.number === number && p.seenHeadSha === head);
  const copy = (p: StoredPress) => structuredClone(p);

  const collectOf = (signOffs: boolean, ventureIds: string[], limit: number, bytes: number, size: Room['size'], alwaysOne: boolean) => {
    const waiting = all.filter((p) =>
      ventureIds.includes(p.ventureId) && p.source === 'studio' && p.collectedAt === null && (p.action === 'accept') === signOffs
      && !hasLapsed(p, now().getTime()));
    const { chosen, used } = choose(waiting, limit, bytes, size, alwaysOne);
    const at = now().toISOString();
    const out = all.filter((p) => chosen.some((c) => c.id === p.id));
    for (const p of out) p.collectedAt = at;
    return { list: out.sort(oldestFirst).map(copy), more: waiting.length > chosen.length, used };
  };

  return {
    async press(v, p) {
      const head = headOf(v, p.repo, p.number);
      if (head === null) return 'no-card';
      const here = onCard(v, p.repo, p.number, head);
      if (here.some((x) => stands(x, now().getTime()))) return 'out-of-date';
      if (p.seenHeadSha !== null && p.seenHeadSha !== head) return 'changed';
      if (p.action === 'accept' && here.some((x) => x.action === 'accept' && x.by === p.by)) return 'already-signed-off';
      all.push({
        id: randomUUID(), ventureId: v, repo: p.repo, number: p.number, action: p.action, by: p.by, byJohn: p.byJohn,
        source: 'studio', note: p.note, seenHeadSha: head, pressedAt: now().toISOString(), collectedAt: null, answer: null,
      });
      return 'recorded';
    },

    async presses(v, repo, number) {
      const head = headOf(v, repo, number);
      return head === null ? [] : onCard(v, repo, number, head).sort(oldestFirst).map(copy);
    },

    async collect(ventureIds, room) {
      const presses = collectOf(false, ventureIds, room.limit, room.bytes, room.size, true);
      const signOffs = collectOf(true, ventureIds, room.limit, room.bytes - presses.used, room.size, presses.list.length === 0);
      return { presses: presses.list, signOffs: signOffs.list, more: presses.more || signOffs.more };
    },

    async answer(ventureIds, id, outcome, message) {
      const p = all.find((x) => x.id === id && ventureIds.includes(x.ventureId));
      if (!p) return 'no-press';
      if (p.action === 'accept') return 'sign-off';
      if (!p.answer) {
        const at = now().toISOString();
        p.answer = { outcome, message, at };
        p.collectedAt ??= at;
        return 'stored';
      }
      return p.answer.outcome === outcome && p.answer.message === message ? 'same' : 'different';
    },

    async telegram(v, t) {
      const head = headOf(v, t.repo, t.number);
      if (head === null) return 'no-card';
      const was = all.find((x) => x.ventureId === v && x.source === 'telegram' && x.repo === t.repo && x.number === t.number
        && x.action === t.action && x.pressedAt === t.at);
      if (was) return was.answer?.outcome === t.outcome && was.answer.message === t.message ? 'same' : 'different';
      const at = now().toISOString();
      all.push({
        id: randomUUID(), ventureId: v, repo: t.repo, number: t.number, action: t.action, by: t.by, byJohn: true,
        source: 'telegram', note: '', seenHeadSha: head, pressedAt: t.at, collectedAt: at,
        answer: { outcome: t.outcome, message: t.message, at },
      });
      return 'stored';
    },
  };
}
