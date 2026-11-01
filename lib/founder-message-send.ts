import type { StoredCard } from './card-store';
import type { VentureSummary } from './ventures';
import type { Querier } from './push-store';
import type { Poster, VapidKeys } from './webpush';
import { pushCardMessage } from './push-send';
import { cardEmail, cardMessage, isFounderMessage, messageKey } from './founder-message';
import { claimCardMessage, recordCardMessage, type MessageOutcome } from './founder-message-store';
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
 *   6. What happened is written on the claim.
 *
 * At most once, on purpose: if the studio stops between the claim and the send, that card gets no
 * message and its claim stays `pending`. "Never both" and "only one" matter more than a delivery
 * that might go twice.
 *
 * It never throws. It runs after the box has been answered, and a fault here must not reach anything.
 */
export interface MessageDeps {
  venture: Pick<VentureSummary, 'id' | 'name' | 'founderEmail'>;
  card: StoredCard;
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

export type MessageResult = 'not-a-message' | 'no-founder' | 'already' | 'off' | MessageOutcome;

export async function messageFounder(deps: MessageDeps): Promise<MessageResult> {
  const { venture, card } = deps;
  const where = `${card.repo}#${card.number} ${card.state}`;
  const say = (line: string) => deps.log(`[founder-messages] ${venture.id} ${where}: ${line}`);
  try {
    if (!isFounderMessage(venture.id, card)) return 'not-a-message';
    const founder = venture.founderEmail?.trim().toLowerCase();
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

    const keys = deps.keys;
    const pushed = keys ? await deps.run((q) => pushCardMessage(q, venture, card, founder, keys, { post: deps.post })) : null;
    let outcome: MessageOutcome;
    if (pushed && pushed.sent > 0) {
      outcome = 'notification';
    } else {
      const noPush = !keys ? 'this studio cannot send notifications' : 'no notification was delivered';
      const studioUrl = deps.studioUrl?.startsWith('https://') ? deps.studioUrl : null;
      if (!deps.mail) {
        say(`${noPush}, and ${deps.noMail ?? 'this studio has no email settings'}, so no email was sent.`);
        outcome = 'none';
      } else if (!studioUrl) {
        say(`${noPush}, and the studio does not know its own https address (STUDIO_PUBLIC_URL or AUTH_URL), so no email was sent.`);
        outcome = 'none';
      } else {
        const email = cardEmail(cardMessage(venture, card), { studioUrl, venture, to: founder, from: deps.mail.from });
        const sent = await (deps.send ?? sendMail)(deps.mail, email, { log: deps.log });
        if (sent === 'sent') outcome = 'email';
        else {
          say(`${noPush}, and the email could not be sent.`);
          outcome = 'none';
        }
      }
    }
    await deps.run((q) => recordCardMessage(q, key, outcome));
    if (outcome !== 'none') say(`the founder was sent ${outcome === 'email' ? 'an email' : 'a notification'}.`);
    return outcome;
  } catch (e) {
    say(`no message was sent: ${(e as Error)?.message ?? 'unknown fault'}`);
    return 'none';
  }
}
