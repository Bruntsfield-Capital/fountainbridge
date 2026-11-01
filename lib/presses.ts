/**
 * Presses on the factory's cards (FB-276): what they are, and who may make which.
 *
 * Pure: no reads, and no clock of its own. Whatever depends on the time is handed `now`. The store
 * keeps them (`lib/press-store.ts`, `db/009_factory_presses.sql`); the studio's side of a press is
 * `lib/press.ts`; the box's side is the door (`lib/factory-door.ts`).
 */

/** Every press, as the box and the database name them. */
export const PRESS_ACTIONS = ['stop', 'send-back', 'accept', 'approve', 'reject', 'try-again', 'split'] as const;
export type PressAction = (typeof PRESS_ACTIONS)[number];

export const isPressAction = (v: unknown): v is PressAction => (PRESS_ACTIONS as readonly unknown[]).includes(v);

/**
 * What a founder may press on their own venture's cards (PRD, "Who may press what"). John may press
 * everything, and his Accept is his Approve.
 */
export const FOUNDER_ACTIONS: readonly PressAction[] = ['stop', 'send-back', 'accept'];

export function mayPress(action: PressAction, isJohn: boolean): boolean {
  return isJohn ? action !== 'accept' : FOUNDER_ACTIONS.includes(action);
}

/** Every press but a sign-off settles the card: nothing more can be pressed on that version. */
export const settles = (action: PressAction) => action !== 'accept';

/** What the box said happened. */
export const OUTCOMES = ['done', 'out-of-date', 'refused'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const isOutcome = (v: unknown): v is Outcome => (OUTCOMES as readonly unknown[]).includes(v);

export interface BoxAnswer {
  outcome: Outcome;
  message: string;
  at: string;
}

/** One press, as the store keeps it. */
export interface StoredPress {
  id: string;
  ventureId: string;
  repo: string;
  number: number;
  action: PressAction;
  /** The address the presser signed in with. For a tap on Telegram, John's. */
  by: string;
  byJohn: boolean;
  source: 'studio' | 'telegram';
  note: string;
  /** The version of the work they were shown. */
  seenHeadSha: string;
  pressedAt: string;
  collectedAt: string | null;
  answer: BoxAnswer | null;
}

/** A press the studio is about to record. Who pressed, and whether they are John, are the server's. */
export interface NewPress {
  repo: string;
  number: number;
  action: PressAction;
  by: string;
  byJohn: boolean;
  note: string;
  /** The version of the work the page showed, when it said. Must still be the card's. */
  seenHeadSha: string | null;
}

/**
 * What the store did with a press.
 *
 *   - `recorded`: kept, for the box to collect.
 *   - `no-card`: there is no such card for this venture.
 *   - `out-of-date`: a press already stands on this version of the card. The first press wins.
 *   - `changed`: the card is about a newer version of the work than the page showed.
 *   - `already-signed-off`: this founder has signed this version off already.
 */
export type PressKept = 'recorded' | 'no-card' | 'out-of-date' | 'changed' | 'already-signed-off';

/** A tap on Telegram, as the box reports it. */
export interface TelegramPress {
  repo: string;
  number: number;
  action: PressAction;
  at: string;
  /** John's address: Telegram is John's. */
  by: string;
  outcome: Outcome;
  message: string;
}

/**
 * How long the box has to take a press, and then to answer it (FB-278). A press the box has not
 * collected 10 minutes after it was made, or has collected and not answered 10 minutes after that,
 * has lapsed: the card shows "Nothing was done." and takes a new press. The studio stores no answer
 * for it, so if the box's real answer comes later, that is what the card shows.
 */
export const LAPSE_MS = 10 * 60_000;

/** What a lapsed press says, by whether the box ever took it. Each ends "Nothing was done.". */
export const NOT_COLLECTED = 'The factory did not pick up the last decision within 10 minutes. Nothing was done.';
export const NOT_ANSWERED = 'The factory took the last decision but did not say what happened within 10 minutes. Nothing was done.';

/**
 * When a press lapses, if the box does not answer it first. Null for a press that cannot lapse: a
 * sign-off, which the box never answers; a tap on Telegram, which arrives answered; or one answered.
 */
export function lapsesAt(p: Pick<StoredPress, 'action' | 'source' | 'pressedAt' | 'collectedAt' | 'answer'>): number | null {
  if (!settles(p.action) || p.source !== 'studio' || p.answer !== null) return null;
  return Date.parse(p.collectedAt ?? p.pressedAt) + LAPSE_MS;
}

export function hasLapsed(p: Parameters<typeof lapsesAt>[0], now: number): boolean {
  const at = lapsesAt(p);
  return at !== null && now >= at;
}

/**
 * A press that still stands: it settles the card, the box has not said it did nothing, and it has
 * not lapsed. While one stands, every other settling press on that version of the card is out of date.
 */
export function stands(p: Parameters<typeof lapsesAt>[0], now: number): boolean {
  return settles(p.action) && (p.answer === null ? !hasLapsed(p, now) : p.answer.outcome === 'done');
}

/**
 * How long the box may go without a heartbeat before its cards are out of date (FB-278). It sends one
 * a minute, so five missed is a box that has stopped, not one that is late.
 */
export const QUIET_MS = 5 * 60_000;

/** When the box last reported, if that was more than `QUIET_MS` ago. Null while it is reporting. */
export function quietSince(lastReport: string | null, now: number): string | null {
  if (lastReport === null) return null;
  const at = Date.parse(lastReport);
  return Number.isFinite(at) && now - at > QUIET_MS ? lastReport : null;
}

/** "10:42", or "29 Oct, 10:42" when it was not today. In London time, as the rest of the studio. */
export function reportedWhen(iso: string, now: number): string {
  const zone = { timeZone: 'Europe/London' } as const;
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...zone }).format(Date.parse(iso));
  const day = (ms: number) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...zone }).format(ms);
  return day(Date.parse(iso)) === day(now) ? time : `${day(Date.parse(iso))}, ${time}`;
}

/** What the cards say while the box is quiet (harness journey 7). */
export const quietLine = (since: string, now: number) =>
  `The factory hasn't reported since ${reportedWhen(since, now)}. These may be out of date.`;

/** Why a card's buttons are off while the box is quiet, said beside them. */
export const BUTTONS_OFF = 'The buttons are off until the factory reports again, because a decision made now would not reach it.';

/** The most the box collects at once, of presses and of sign-offs each, so an answer stays small. */
export const COLLECT_LIMIT = 20;
