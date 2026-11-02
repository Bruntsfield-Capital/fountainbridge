import { sendHref, workHref } from './palette';

/**
 * The one push (FB-141, gap G8).
 *
 * The design asks for exactly one notification and the restraint is the point:
 *
 * > A push the moment the founder becomes the blocker. **Nothing else pushes**; the queue is the
 * > only thing that waits on a person.
 *
 * FB-279 adds one more reason, on purpose and at John's request: the founder hears once when their
 * team's work is finished, stuck or sent back (`pushCardMessage` in lib/push-send.ts). Both reasons
 * are sent from that one file, and nothing else pushes.
 *
 * ## Why the rule is a transition, not a count
 *
 * A founder with nine decisions waiting does not want nine buzzes. They want to be told once that
 * they have become the bottleneck — and a phone that buzzes nine times is a phone whose owner turns
 * notifications off, which loses the one notification that mattered. So this fires on the edge from
 * *nothing waiting* to *something waiting*, and stays silent for everything after it until the queue
 * has been cleared.
 *
 * ## Why this module has no transport in it
 *
 * Deciding what to send is a rule; sending it is plumbing with a secret attached. The rule is the
 * part that is easy to get wrong and easy to test, so it is separate and pure. See the ticket for
 * where the transport decision stands — it is not built, and nothing here pretends it is.
 */

/** What the studio knows about a founder's queue between two reads. */
export interface QueueTransition {
  /** What was waiting last time this founder's queue was looked at. `null` = never looked. */
  before: number | null;
  /** What is waiting now. */
  now: number;
}

/**
 * Should this transition wake a founder's phone?
 *
 * Exactly one case: the queue went from empty to not-empty. Not "grew", not "is non-zero".
 *
 * `before: null` — the first time the studio ever looks at this founder's queue — is deliberately
 * **not** a push. A founder installing the studio and immediately being buzzed about a backlog that
 * has been there for a week is a notification about the past, and it teaches them that the buzz does
 * not mean "something just happened".
 */
export function shouldNotify(t: QueueTransition): boolean {
  if (t.before === null) return false;
  return t.before === 0 && t.now > 0;
}

/**
 * What the push says.
 *
 * Names the venture, because a founder may hold more than one, and a buzz that does not say which is
 * a buzz that costs them a navigation to understand. Counts, because "something waits on you" and
 * "six things wait on you" are different mornings.
 *
 * No detail beyond that: a lock screen is read by whoever is holding the phone, and the titles of a
 * venture's work are not for them.
 */
export function pushMessage(ventureName: string, waiting: number): { title: string; body: string } {
  return {
    title: `${ventureName} needs you`,
    body: waiting === 1
      ? 'One thing is waiting on your decision.'
      : `${waiting} things are waiting on your decision.`,
  };
}

/**
 * Where a push opens.
 *
 * The thing the notification is about. When exactly one thing is waiting, that is the item itself —
 * its ticket, its work page, or the send's own page (FB-179: a notification deep-links to the exact
 * item). When several are, it is the queue, filtered to what waits on this founder. Never the desk:
 * a founder woken by a buzz has one question, and answering it with a whole screen and a search is
 * how a useful notification becomes an annoying one.
 *
 * The address travels inside the encrypted message and is never shown on the lock screen, so naming
 * the item here does not break the rule that the push says nothing about what is waiting.
 */
export type SoleItem =
  | { kind: 'work'; repo: string; number: number; title: string; ticketId: string | null }
  | { kind: 'send'; repo: string; id: string };

export const pushDestination = (ventureId: string, sole: SoleItem | null = null): string => {
  if (sole?.kind === 'work') return workHref(ventureId, sole);
  if (sole?.kind === 'send') return sendHref(ventureId, sole);
  return `/venture/${ventureId}/tickets?filter=needs`;
};
