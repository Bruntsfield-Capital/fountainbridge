import { shouldNotify, pushMessage, pushDestination, type SoleItem } from './push';
import { forgetPhone, observeQueue, phones, phonesOf, type Querier } from './push-store';
import { sendWebPush, type Poster, type PushTarget, type VapidKeys } from './webpush';
import type { StoredCard } from './card-store';
import { cardMessage, type MessageState } from './founder-message';

/**
 * The only place in the studio that sends a push (FB-141).
 *
 * "Nothing else pushes" is a rule that erodes one well-meant addition at a time, so it is held two
 * ways. Neither function here takes words: there is no parameter through which a caller could send
 * anything but the messages written in this repository. And the test "sendWebPush is called from
 * exactly one file", in `lib/__tests__/push-store.test.ts`, fails if `sendWebPush` is ever called
 * from any other file.
 *
 * There are exactly two reasons to push:
 *
 * - `checkQueue` takes a COUNT: "you are the blocker". (`sole` is an address, not words: when
 *   exactly one thing waits, the push opens it rather than the list — FB-179.)
 * - `pushCardMessage` takes a stored CARD (FB-279): the founder's team finished something, got
 *   stuck, or had work sent back. John asked for founders to hear about those on their phone, and
 *   the words are built from the card's state alone, by `cardMessage`.
 */
export interface QueueCheck {
  /** What was waiting last time, or null for a first look. */
  before: number | null;
  /** What is waiting now, or null when it could not be read — then nothing is recorded or sent. */
  now: number | null;
  sent: number;
  /** Phones that had unsubscribed themselves, removed so they are not tried again. */
  removed: number;
  failed: number;
}

/**
 * Look at one venture's queue, remember it, and buzz this venture's phones if the founder has just
 * become the blocker.
 *
 * `q` must already be scoped to this venture (`withVenture`). The phones it reads are therefore only
 * this venture's phones — a push for ARCA cannot reach a phone that only subscribed to The Reset.
 *
 * An unreadable queue is NOT zero. Recording it as zero would turn the next good read into a
 * "zero to something" transition, and the founder would be buzzed about work that had been waiting
 * all along, because GitHub hiccupped.
 */
export async function checkQueue(
  q: Querier,
  venture: { id: string; name: string },
  waiting: number | null,
  keys: VapidKeys,
  opts: { post?: Poster; sole?: SoleItem | null } = {},
): Promise<QueueCheck> {
  if (waiting === null) return { before: null, now: null, sent: 0, removed: 0, failed: 0 };

  const before = await observeQueue(q, waiting);
  const out: QueueCheck = { before, now: waiting, sent: 0, removed: 0, failed: 0 };
  if (!shouldNotify({ before, now: waiting })) return out;

  return { ...out, ...(await pushToEach(q, await phones(q), pushPayload(venture, waiting, opts.sole ?? null), keys, opts.post)) };
}

/**
 * Tell a founder's own phones about one card (FB-279). Only the phones the founder turned on under
 * this venture: `q` is scoped to it, and `phonesOf` reads only the founder's address.
 *
 * `sent` above zero is the only sign Web Push gives that a phone took it, and the email waits on it.
 */
export async function pushCardMessage(
  q: Querier,
  venture: { id: string; name: string },
  card: StoredCard & { state: MessageState },
  founderEmail: string,
  keys: VapidKeys,
  opts: { post?: Poster } = {},
): Promise<{ sent: number; removed: number; failed: number }> {
  return pushToEach(q, await phonesOf(q, founderEmail), cardMessage(venture, card), keys, opts.post);
}

/** One message to each phone. A phone that has unsubscribed itself is removed, so it is not tried again. */
async function pushToEach(q: Querier, targets: PushTarget[], message: unknown, keys: VapidKeys, post: Poster | undefined) {
  const out = { sent: 0, removed: 0, failed: 0 };
  for (const phone of targets) {
    const r = await sendWebPush(phone, message, keys, { post });
    if (r === 'sent') out.sent += 1;
    else if (r === 'gone') {
      // A phone that can't be forgotten now is tried, and forgotten, next time. Never thrown: by now
      // an earlier phone may have the message, and a throw would look as if nothing went (FB-290).
      try { await forgetPhone(q, phone.endpoint); out.removed += 1; } catch { out.failed += 1; }
    }
    else out.failed += 1;
  }
  return out;
}

/**
 * Exactly what a phone is sent: the words, where pressing it goes, and a tag so a second buzz for the
 * same venture replaces the first rather than stacking.
 *
 * The single item is used only when exactly one thing is waiting. With more, "the one item" would be
 * an arbitrary pick, and the honest destination is the list.
 */
export function pushPayload(venture: { id: string; name: string }, waiting: number, sole: SoleItem | null) {
  return {
    ...pushMessage(venture.name, waiting),
    url: pushDestination(venture.id, waiting === 1 ? sole : null),
    tag: `blocker-${venture.id}`,
  };
}
