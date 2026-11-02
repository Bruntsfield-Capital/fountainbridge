import type { StoredCard } from './card-store';
import { founderAddress } from './authz';
import type { VentureSummary } from './ventures';
import type { Querier } from './push-store';
import type { Poster, VapidKeys } from './webpush';
import { pushCardMessage } from './push-send';
import { cardEmail, cardMessage, isFounderMessage, messageKey, type MessageState } from './founder-message';
import {
  claimCardMessage, dueCardMessages, giveUpCardMessage, MAX_ATTEMPTS, messagesOff, recordCardMessage, takeCardMessage,
  type DueMessage, type MessageKey, type MessageOutcome,
} from './founder-message-store';
import { sendMail, type MailSettings } from './mail';

/**
 * Tell a venture's founder, once, that a card of theirs needs them (FB-279).
 *
 * In order:
 *
 *   1. Only a `finished`, `stuck` or `sent-back` card of a venture's own (never cowgate's).
 *   2. Only to the manifest's founder. The recipient is never taken from the card.
 *   3. The message is claimed before anything is sent, so only one request ever sends it, and a
 *      founder who stopped these messages gets nothing.
 *   4. A notification to the founder's own phones.
 *   5. Only if no phone took it: the same words by email.
 *   6. What happened is written on the claim, and, if nothing went, why.
 *
 * A message that did not go, or that was left `pending` because the studio stopped between the
 * claim and the send, is tried again on a later heartbeat (`retryFounderMessages`), three tries in
 * all.
 *
 * It never throws. It runs after the box has been answered, and a fault here must not reach anything.
 */
export interface SendDeps {
  venture: Pick<VentureSummary, 'id' | 'name' | 'founderEmail'>;
  /** Run queries as this venture: `withVenture(venture.id, …)` in the studio. */
  run<T>(fn: (q: Querier) => Promise<T>): Promise<T>;
  keys: VapidKeys | null;
  mail: MailSettings | null;
  /** Why `mail` is null, for the log. */
  noMail?: string;
  /** The studio's own https address, for the email's link. */
  studioUrl: string | null;
  post?: Poster;
  send?: typeof sendMail;
  log(line: string): void;
}

export interface MessageDeps extends SendDeps {
  card: StoredCard;
}

export type MessageResult = 'not-a-message' | 'no-founder' | 'already' | 'off' | MessageOutcome;

export async function messageFounder(deps: MessageDeps): Promise<MessageResult> {
  const { venture, card } = deps;
  const say = sayer(deps, `${card.repo}#${card.number} ${card.state}`);
  let outcome: MessageOutcome | null = null;
  try {
    if (!isFounderMessage(venture.id, card)) return 'not-a-message';
    const founder = founderAddress(venture);
    if (!founder) {
      say('this venture names no founder, so nobody was messaged.');
      return 'no-founder';
    }
    const key = messageKey(card);
    const claim = await deps.run((q) => claimCardMessage(q, key, founder));
    if (claim === 'already') return 'already';
    if (claim === 'off') {
      say('the founder has stopped these messages, so nothing was sent.');
      return 'off';
    }

    const sent = await deliver(deps, card, founder, say);
    outcome = sent.outcome;
    await deps.run((q) => recordCardMessage(q, key, sent.outcome, sent.why));
    if (sent.outcome !== 'none') say(`the founder was sent ${sentWords(sent.outcome)}.`);
    return sent.outcome;
  } catch (e) {
    sayFault(say, outcome, e);
    return outcome ?? 'none';
  }
}

export interface RetryDeps extends SendDeps {
  /** The card the studio holds now for this repository and number, under this venture. */
  card(repo: string, number: number): Promise<StoredCard | null>;
}

/** What one retry did. `taken`: another request had already taken it, so this one did nothing. */
export type RetryResult = MessageOutcome | 'outdated' | 'off' | 'given-up' | 'taken';

/**
 * Try again the venture's messages that did not go (FB-279): those still `pending` (the studio
 * stopped between the claim and the send) or `none` (nothing could be sent), last tried more than
 * ten minutes ago. The heartbeat runs it, once a minute, after the box has its answer.
 *
 * Each one is taken first, and only if nobody has taken it since it was read, so two heartbeats at
 * once never both send it. It is sent again only if the card the studio holds is still the same
 * version on the same occasion; if the card has moved on, it is marked `outdated` and nothing is
 * sent. When its third try fails, it is `given-up`, and the next heartbeat tells the box, for John.
 *
 * The rules of the first try still hold: only the manifest's founder, never both a notification and
 * an email, and nothing for a founder who has stopped these messages. It never throws.
 */
export async function retryFounderMessages(deps: RetryDeps): Promise<RetryResult[]> {
  const founder = founderAddress(deps.venture);
  if (!founder) return [];
  let due: DueMessage[];
  try {
    due = await deps.run((q) => dueCardMessages(q));
  } catch (e) {
    deps.log(`[founder-messages] ${deps.venture.id}: the messages to try again could not be read: ${(e as Error)?.message ?? 'unknown fault'}`);
    return [];
  }
  const out: RetryResult[] = [];
  for (const one of due) out.push(await retryOne(deps, founder, one));
  return out;
}

async function retryOne(deps: RetryDeps, founder: string, due: DueMessage): Promise<RetryResult> {
  const { key } = due;
  const say = sayer(deps, `${key.repo}#${key.number} ${key.state}`);
  let outcome: MessageOutcome | null = null;
  try {
    if (due.attempts >= MAX_ATTEMPTS) {
      // Its last try was cut off before it could say what happened.
      const why = 'the studio stopped before it finished sending it';
      if (!(await deps.run((q) => giveUpCardMessage(q, due, why)))) return 'taken';
      say(`gave up after ${MAX_ATTEMPTS} tries: ${why}.`);
      return 'given-up';
    }
    const attempt = await deps.run((q) => takeCardMessage(q, due));
    if (attempt === null) return 'taken';

    const card = await deps.card(key.repo, key.number);
    if (!card || !isFounderMessage(deps.venture.id, card) || !sameKey(messageKey(card), key) || due.email !== founder) {
      await deps.run((q) => recordCardMessage(q, key, 'outdated'));
      say('the card has moved on since, so the message was not sent again.');
      return 'outdated';
    }
    if (await deps.run((q) => messagesOff(q, founder))) {
      await deps.run((q) => recordCardMessage(q, key, 'off'));
      say('the founder has stopped these messages, so nothing was sent.');
      return 'off';
    }

    const sent = await deliver(deps, card, founder, say);
    outcome = sent.outcome;
    const last = sent.outcome === 'none' && attempt >= MAX_ATTEMPTS;
    await deps.run((q) => recordCardMessage(q, key, last ? 'given-up' : sent.outcome, sent.why));
    if (last) {
      say(`gave up after ${MAX_ATTEMPTS} tries.`);
      return 'given-up';
    }
    if (sent.outcome !== 'none') say(`on try ${attempt}, the founder was sent ${sentWords(sent.outcome)}.`);
    return sent.outcome;
  } catch (e) {
    sayFault(say, outcome, e);
    return outcome ?? 'none';
  }
}

const sameKey = (a: MessageKey, b: MessageKey) =>
  a.repo === b.repo && a.number === b.number && a.state === b.state && a.headSha === b.headSha && a.occasion === b.occasion;

/**
 * Send one message: a notification to the founder's phones, or, only if none took it, an email.
 * When nothing went, `why` says so in plain words, and never names an address or a secret.
 */
async function deliver(
  deps: SendDeps,
  card: StoredCard & { state: MessageState },
  founder: string,
  say: (line: string) => void,
): Promise<{ outcome: MessageOutcome; why: string | null }> {
  const { venture } = deps;
  const keys = deps.keys;
  const pushed = keys ? await deps.run((q) => pushCardMessage(q, venture, card, founder, keys, { post: deps.post })) : null;
  if (pushed && pushed.sent > 0) return { outcome: 'notification', why: null };

  const noPush = !keys ? 'this studio cannot send notifications' : 'no notification was delivered';
  const studioUrl = deps.studioUrl?.startsWith('https://') ? deps.studioUrl : null;
  let why: string;
  if (!deps.mail) {
    why = `${noPush}, and ${deps.noMail ?? 'this studio has no email settings'}, so no email was sent.`;
  } else if (!studioUrl) {
    why = `${noPush}, and the studio does not know its own https address (STUDIO_PUBLIC_URL or AUTH_URL), so no email was sent.`;
  } else {
    const email = cardEmail(cardMessage(venture, card), { studioUrl, venture, to: founder, from: deps.mail.from });
    const sent = await (deps.send ?? sendMail)(deps.mail, email, { log: deps.log });
    if (sent === 'sent') return { outcome: 'email', why: null };
    why = `${noPush}, and the email could not be sent.`;
  }
  say(why);
  return { outcome: 'none', why };
}

function sayer(deps: Pick<SendDeps, 'venture' | 'log'>, where: string) {
  return (line: string) => deps.log(`[founder-messages] ${deps.venture.id} ${where}: ${line}`);
}

function sayFault(say: (line: string) => void, outcome: MessageOutcome | null, e: unknown) {
  const fault = (e as Error)?.message ?? 'unknown fault';
  if (outcome === null) say(`no message was sent: ${fault}`);
  else if (outcome === 'none') say(`no message was sent, and that could not be written down: ${fault}`);
  else say(`the founder was sent ${sentWords(outcome)}, but that could not be written down, so it may be sent again: ${fault}`);
}

const sentWords = (outcome: 'notification' | 'email') => (outcome === 'email' ? 'an email' : 'a notification');
