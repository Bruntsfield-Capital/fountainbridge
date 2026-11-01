import type { Querier } from './push-store';

/**
 * Which card messages a founder has been sent, and whether they have stopped them (FB-279).
 *
 * The same rules as `lib/push-store.ts`: every statement runs inside `withVenture`, and none names a
 * venture, so the database decides which venture's rows are seen. The statements are exported so the
 * tests run these exact strings against real Postgres.
 */

/** One version of one card: what a message is about. */
export interface MessageKey {
  repo: string;
  number: number;
  state: 'finished' | 'stuck' | 'sent-back';
  headSha: string;
}

export type MessageOutcome = 'notification' | 'email' | 'none';

export const MESSAGE_SQL = {
  isOff: 'select 1 from pushstore.messages_off where email = $1',
  claim: `insert into pushstore.card_messages (venture_id, repo, number, state, head_sha, email, outcome)
          values (current_setting('app.venture_id', true), $1, $2, $3, $4, $5, $6)
          on conflict do nothing
          returning 1`,
  record: `update pushstore.card_messages set outcome = $5
           where repo = $1 and number = $2 and state = $3 and head_sha = $4`,
  stop: `insert into pushstore.messages_off (venture_id, email)
         values (current_setting('app.venture_id', true), $1)
         on conflict (venture_id, email) do nothing`,
  start: 'delete from pushstore.messages_off where email = $1',
} as const;

/**
 * Claim the one message for this version of the card, before anything is sent.
 *
 * `claimed`: this request sends it. `already`: it was claimed before, so nothing is sent. `off`: the
 * founder has stopped these messages; the claim is still written, so starting them again later does
 * not send a message about a card that came while they were stopped.
 */
export async function claimCardMessage(q: Querier, key: MessageKey, email: string): Promise<'claimed' | 'off' | 'already'> {
  const off = await messagesOff(q, email);
  const { rows } = await q.query(MESSAGE_SQL.claim, [key.repo, key.number, key.state, key.headSha, email.toLowerCase(), off ? 'off' : 'pending']);
  if (rows.length === 0) return 'already';
  return off ? 'off' : 'claimed';
}

/** Say what happened to a claimed message. */
export async function recordCardMessage(q: Querier, key: MessageKey, outcome: MessageOutcome): Promise<void> {
  await q.query(MESSAGE_SQL.record, [key.repo, key.number, key.state, key.headSha, outcome]);
}

export async function messagesOff(q: Querier, email: string): Promise<boolean> {
  const { rows } = await q.query(MESSAGE_SQL.isOff, [email.toLowerCase()]);
  return rows.length > 0;
}

export async function setMessagesOff(q: Querier, email: string, off: boolean): Promise<void> {
  await q.query(off ? MESSAGE_SQL.stop : MESSAGE_SQL.start, [email.toLowerCase()]);
}
