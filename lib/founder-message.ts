import type { StoredCard } from './card-store';
import { cardHref, cardRow, FACTORY_VENTURE } from './factory-work';
import type { MessageKey } from './founder-message-store';

/**
 * What a founder is told when their team's work needs them (FB-279), and the words of the switch
 * that stops it. Pure, so every word here is tested and copy-linted.
 *
 * The message says which venture, and never the work's title: whoever holds the phone reads the lock
 * screen (FB-141's rule in `pushMessage`). An email carries the same words, as the ticket asks. No
 * dollar figure and none of John's lines can reach it: it is built from the state alone.
 */
export const MESSAGE_STATES = ['finished', 'stuck', 'sent-back'] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

/** A card the founder is told about: one of the three states, of a venture's own work. */
export function isFounderMessage<C extends Pick<StoredCard, 'state'>>(ventureId: string, card: C): card is C & { state: MessageState } {
  return ventureId !== FACTORY_VENTURE && (MESSAGE_STATES as readonly string[]).includes(card.state);
}

export function messageKey(card: StoredCard & { state: MessageState }): MessageKey {
  return { repo: card.repo, number: card.number, state: card.state, headSha: card.headSha };
}

const WORDS: Record<MessageState, (name: string) => { title: string; body: string }> = {
  finished: (name) => ({ title: `${name}: your team finished something`, body: 'It is ready for you to look at and decide.' }),
  stuck: (name) => ({ title: `${name}: your team is stuck`, body: 'They stopped and need a person to decide how the work goes on.' }),
  'sent-back': (name) => ({ title: `${name}: work went back to your team`, body: 'It went back with a note, and your team is working on it again.' }),
};

export interface CardMessage {
  title: string;
  body: string;
  /** Where pressing it goes, inside the studio: the card's Review screen, or its row on Tickets. */
  url: string;
  /** The same tag as the blocker buzz, so the phone shows one notification per venture, not a stack. */
  tag: string;
}

export function cardMessage(venture: { id: string; name: string }, card: StoredCard & { state: MessageState }): CardMessage {
  const row = cardRow({ ventureId: venture.id, card, presses: [], readAt: 0 }, { isJohn: false, name: (e) => e }, venture.name);
  return { ...WORDS[card.state](venture.name), url: cardHref(row), tag: `blocker-${venture.id}` };
}

export interface CardEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** The same message as an email: plain text, so there is nothing in it a card could inject into. */
export function cardEmail(
  message: CardMessage,
  { studioUrl, venture, to, from }: { studioUrl: string; venture: { id: string; name: string }; to: string; from: string },
): CardEmail {
  const base = studioUrl.replace(/\/+$/, '');
  return {
    from,
    to,
    subject: message.title,
    text: [
      message.body,
      '',
      `Open it in the studio: ${base}${message.url}`,
      '',
      `You get these messages because you are ${venture.name}'s founder in Foundry Studio. To stop them, open ${base}/venture/${venture.id}/tickets and press "${MESSAGE_WORDS.stop}".`,
      '',
    ].join('\n'),
  };
}

const ABOUT = 'When your team finishes something, gets stuck, or has work sent back, the studio tells you once';

/** The switch at the foot of "Needs you", and what its button can answer. */
export const MESSAGE_WORDS = {
  onWithEmail: (email: string) => `${ABOUT}: as a notification on your phone if you have turned them on, or as an email to ${email} if not.`,
  onWithoutEmail: `${ABOUT}, as a notification on your phone if you have turned them on.`,
  off: 'The studio does not message you when your team finishes something, gets stuck, or has work sent back.',
  unread: 'The studio could not check just now whether it messages you. Try again in a minute.',
  stop: 'Stop these messages',
  start: 'Start these messages again',
  notFounder: 'Only the founder of this venture gets these messages, so only they can switch them.',
  noStore: 'The studio has nowhere to keep this choice yet. Nothing was changed.',
  failed: 'The studio could not save this just now. Try again in a minute.',
} as const;
