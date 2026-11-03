import type { PushTarget } from './webpush';

/**
 * A founder's phones, and what their queue looked like last time (FB-141).
 *
 * Every statement here runs inside `withVenture` (lib/db.ts), so the database itself decides which
 * venture's rows are visible. None of them names a venture: inserts take it from the connection's own
 * scope, `current_setting('app.venture_id')`. Code here cannot write a phone under another venture
 * even by passing the wrong id, because there is no id to pass.
 *
 * The statements are exported so the tests run THESE strings against real Postgres, rather than a
 * hand-copied version of them that could drift (the lesson FB-170's cache test records).
 */

/** Anything with pg's `query(text, params)` shape — a pooled client in the studio, PGlite in tests. */
export interface Querier {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export const SQL = {
  forget: 'delete from pushstore.subscriptions where endpoint = $1',
  remember: `insert into pushstore.subscriptions (venture_id, email, endpoint, p256dh, auth)
             values (current_setting('app.venture_id', true), $1, $2, $3, $4)`,
  phones: 'select endpoint, p256dh, auth from pushstore.subscriptions order by created_at',
  phonesOf: 'select endpoint, p256dh, auth from pushstore.subscriptions where email = $1 order by created_at',
  lastSeen: 'select waiting from pushstore.queue_watch',
  see: `insert into pushstore.queue_watch (venture_id, waiting, seen_at)
        values (current_setting('app.venture_id', true), $1, now())
        on conflict (venture_id) do update set waiting = excluded.waiting, seen_at = excluded.seen_at`,
} as const;

/**
 * Keep this phone. Replaces any earlier row for the same endpoint, because a browser that
 * re-subscribes can hand back the same address with new keys, and the old keys would encrypt a
 * message the phone can no longer read.
 */
export async function rememberPhone(q: Querier, email: string, target: PushTarget): Promise<void> {
  await q.query(SQL.forget, [target.endpoint]);
  await q.query(SQL.remember, [email.toLowerCase(), target.endpoint, target.keys.p256dh, target.keys.auth]);
}

/** Stop sending to this phone. The one-press "turn it off", and the clean-up for a phone that left. */
export async function forgetPhone(q: Querier, endpoint: string): Promise<void> {
  await q.query(SQL.forget, [endpoint]);
}

export async function phones(q: Querier): Promise<PushTarget[]> {
  return targets(await q.query<PhoneRow>(SQL.phones));
}

/**
 * The phones one person turned notifications on from, under this venture (FB-279). A card message is
 * the founder's alone, and John's phone, subscribed while he looks at the venture, is not theirs.
 */
export async function phonesOf(q: Querier, email: string): Promise<PushTarget[]> {
  return targets(await q.query<PhoneRow>(SQL.phonesOf, [email.toLowerCase()]));
}

interface PhoneRow { endpoint: string; p256dh: string; auth: string }
const targets = ({ rows }: { rows: PhoneRow[] }): PushTarget[] =>
  rows.map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));

/**
 * Record what is waiting now, and return what was waiting last time — `null` if the studio has never
 * looked. Read and written in the caller's one transaction.
 */
export async function observeQueue(q: Querier, waiting: number): Promise<number | null> {
  const { rows } = await q.query<{ waiting: number }>(SQL.lastSeen);
  await q.query(SQL.see, [waiting]);
  return rows[0]?.waiting ?? null;
}
