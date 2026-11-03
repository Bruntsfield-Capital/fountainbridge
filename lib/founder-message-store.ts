import type { Querier } from './push-store';
import type { MessageState } from './founder-message';

/**
 * Which card messages a founder has been sent, and whether they have stopped them (FB-279).
 *
 * The same rules as `lib/push-store.ts`: every statement runs inside `withVenture`, and none names a
 * venture, so the database decides which venture's rows are seen. The statements are exported so the
 * tests run these exact strings against real Postgres.
 */

/** One version of one card, on one occasion: what a message is about (see `messageKey`). */
export interface MessageKey {
  repo: string;
  number: number;
  state: MessageState;
  headSha: string;
  /** When the box last added to the card's trail, or '' for a finished card's one message per commit. */
  occasion: string;
}

/**
 * Every value a claim's `outcome` can hold; `db/014_founder_messages.sql` checks the same list.
 * `given-up`: three tries, and none could send it. `outdated`: by the time it was tried again, the
 * card had moved on, so it was not sent.
 */
export const CLAIM_OUTCOMES = ['pending', 'off', 'notification', 'email', 'none', 'given-up', 'outdated'] as const;
export type ClaimOutcome = (typeof CLAIM_OUTCOMES)[number];
/** What happened to a claimed message, once it is known. */
export type MessageOutcome = Exclude<ClaimOutcome, 'pending' | 'off' | 'given-up' | 'outdated'>;

/** A message not sent, or left half-sent by a restart, is tried again this long after its last try. */
export const RETRY_AFTER_MINUTES = 10;
/** The most tries a message gets, the first one included. After the last, it is given up. */
export const MAX_ATTEMPTS = 3;
/** The most messages tried again for one venture on one heartbeat, and the most given-up ones reported. */
export const RETRY_LIMIT = 20;

const KEY = 'repo = $1 and number = $2 and state = $3 and head_sha = $4 and occasion = $5';

export const MESSAGE_SQL = {
  isOff: 'select 1 from pushstore.messages_off where email = $1',
  claim: `insert into pushstore.card_messages (venture_id, repo, number, state, head_sha, occasion, email, outcome)
          values (current_setting('app.venture_id', true), $1, $2, $3, $4, $5, $6, $7)
          on conflict do nothing
          returning 1`,
  record: `update pushstore.card_messages set outcome = $6, why = $7 where ${KEY}`,
  // Only a claim still `pending`: one this request holds, never one another request has finished.
  fault: `update pushstore.card_messages set outcome = 'none', why = $6 where ${KEY} and outcome = 'pending'`,
  // `tried_at::text` keeps its microseconds, so `take` can match it exactly.
  due: `select repo, number, state, head_sha, occasion, email, attempts, outcome, why, tried_at::text as tried_at
          from pushstore.card_messages
         where outcome in ('pending', 'none') and tried_at < now() - interval '${RETRY_AFTER_MINUTES} minutes'
         order by tried_at limit $1`,
  // Only where `tried_at` is still what was read: two heartbeats at once can never both take it.
  take: `update pushstore.card_messages set attempts = attempts + 1, tried_at = now(), outcome = 'pending'
          where ${KEY} and tried_at = $6::timestamptz and outcome in ('pending', 'none')
          returning attempts`,
  giveUp: `update pushstore.card_messages set outcome = 'given-up', why = $7
            where ${KEY} and tried_at = $6::timestamptz and outcome in ('pending', 'none')
            returning 1`,
  // Each given-up message is reported once: marked as it is read. The rows are picked once, in the
  // `with`: a subquery in the `where` can be read again for each row, and so pass the limit.
  givenUp: `with picked as materialized (
               select repo, number, state, head_sha, occasion from pushstore.card_messages
                where outcome = 'given-up' and reported_at is null
                order by tried_at limit $1
                for update skip locked)
             update pushstore.card_messages m set reported_at = now()
               from picked p
              where m.repo = p.repo and m.number = p.number and m.state = p.state
                and m.head_sha = p.head_sha and m.occasion = p.occasion
             returning m.repo, m.number, m.state, m.why`,
  stop: `insert into pushstore.messages_off (venture_id, email)
         values (current_setting('app.venture_id', true), $1)
         on conflict (venture_id, email) do nothing`,
  start: 'delete from pushstore.messages_off where email = $1',
} as const;

const keyParams = (key: MessageKey) => [key.repo, key.number, key.state, key.headSha, key.occasion];

/**
 * Claim the one message for this version of the card, before anything is sent.
 *
 * `claimed`: this request sends it. `already`: it was claimed before, so nothing is sent. `off`: the
 * founder has stopped these messages; the claim is still written, so starting them again later does
 * not send a message about a card that came while they were stopped.
 */
export async function claimCardMessage(q: Querier, key: MessageKey, email: string): Promise<'claimed' | 'off' | 'already'> {
  const off = await messagesOff(q, email);
  const outcome: ClaimOutcome = off ? 'off' : 'pending';
  const { rows } = await q.query(MESSAGE_SQL.claim, [...keyParams(key), email.toLowerCase(), outcome]);
  if (rows.length === 0) return 'already';
  return off ? 'off' : 'claimed';
}

/** Say what happened to a claimed message, and, when it was not sent, why, in plain words. */
export async function recordCardMessage(q: Querier, key: MessageKey, outcome: Exclude<ClaimOutcome, 'pending'>, why: string | null = null): Promise<void> {
  await q.query(MESSAGE_SQL.record, [...keyParams(key), outcome, why]);
}

/**
 * A claim that a fault stopped before it could be sent (FB-290): not sent, with a plain reason, so it
 * is tried again and, if it is given up, John is told the real reason. Only while still `pending`.
 */
export async function faultCardMessage(q: Querier, key: MessageKey, why: string): Promise<void> {
  await q.query(MESSAGE_SQL.fault, [...keyParams(key), why]);
}

/** A claim waiting to be tried again: not sent, or left half-sent when the studio stopped. */
export interface DueMessage {
  key: MessageKey;
  email: string;
  attempts: number;
  /** `none`: its last try finished, and `why` says why nothing went. `pending`: a restart cut it off. */
  outcome: 'pending' | 'none';
  why: string | null;
  /** Exactly as the database holds it, to take it only if nobody else has. */
  triedAt: string;
}

/** The claims of this venture's that are due another try, oldest first. */
export async function dueCardMessages(q: Querier, limit = RETRY_LIMIT): Promise<DueMessage[]> {
  const { rows } = await q.query<Record<string, unknown>>(MESSAGE_SQL.due, [limit]);
  return rows.map((r) => ({
    key: { repo: String(r.repo), number: Number(r.number), state: r.state as MessageState, headSha: String(r.head_sha), occasion: String(r.occasion) },
    email: String(r.email),
    attempts: Number(r.attempts),
    outcome: r.outcome === 'none' ? 'none' : 'pending',
    why: r.why == null ? null : String(r.why),
    triedAt: String(r.tried_at),
  }));
}

/** Take a due claim for one more try. The try's number, or null when another request took it first. */
export async function takeCardMessage(q: Querier, due: DueMessage): Promise<number | null> {
  const { rows } = await q.query<{ attempts: number }>(MESSAGE_SQL.take, [...keyParams(due.key), due.triedAt]);
  return rows.length > 0 ? Number(rows[0].attempts) : null;
}

/** Give up a due claim that has had all its tries. False when another request moved it first. */
export async function giveUpCardMessage(q: Querier, due: DueMessage, why: string): Promise<boolean> {
  const { rows } = await q.query(MESSAGE_SQL.giveUp, [...keyParams(due.key), due.triedAt, why]);
  return rows.length > 0;
}

/** A message the studio gave up on, as the box is told of it. */
export interface GivenUpMessage {
  repo: string;
  number: number;
  state: MessageState;
  why: string;
}

/** The given-up messages not reported yet, at most `limit`, marked reported as they are read. */
export async function reportGivenUp(q: Querier, limit = RETRY_LIMIT): Promise<GivenUpMessage[]> {
  const { rows } = await q.query<Record<string, unknown>>(MESSAGE_SQL.givenUp, [limit]);
  return rows.map((r) => ({ repo: String(r.repo), number: Number(r.number), state: r.state as MessageState, why: String(r.why ?? 'no reason was written down') }));
}

export async function messagesOff(q: Querier, email: string): Promise<boolean> {
  const { rows } = await q.query(MESSAGE_SQL.isOff, [email.toLowerCase()]);
  return rows.length > 0;
}

export async function setMessagesOff(q: Querier, email: string, off: boolean): Promise<void> {
  await q.query(off ? MESSAGE_SQL.stop : MESSAGE_SQL.start, [email.toLowerCase()]);
}
