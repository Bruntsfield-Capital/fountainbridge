/**
 * The Review screen's model (FB-274): one finished piece of work, as the person looking at it may
 * see it.
 *
 * A finished card comes from the factory with parts for everyone and parts for John only: what the
 * run cost, its "What to do next" line, and the link to the run itself. A founder must never receive
 * those, so the screen is never handed the card. It is handed `reviewFor(card, viewer)`, which
 * copies the founder's parts by name and adds John's only for John. Anything the card carries that
 * is not named here reaches nobody, which is the rule the factory marks its cards by (cowgate
 * CG-0063: "anything not marked is treated as John's").
 *
 * Pure: no reads, and no clock of its own: what depends on the time is handed `now`. The loader
 * (`lib/review-load.ts`) does the reading.
 */

import type { PreviewCheck } from './result-link';
import { NOT_ANSWERED, NOT_COLLECTED, hasLapsed, lapsesAt, settles, type BoxAnswer, type StoredPress } from './presses';

/** The four pictures: before and after the change, at a computer's size and a phone's. */
export const PICTURES = ['before-computer', 'after-computer', 'before-phone', 'after-phone'] as const;
export type PictureName = (typeof PICTURES)[number];

export const isPictureName = (s: string): s is PictureName => (PICTURES as readonly string[]).includes(s);

/** How a picture is named to a founder, in a note and on the screen. */
export function pictureWords(name: PictureName): string {
  const [when, size] = name.split('-');
  return `the "${when}" picture, ${size === 'phone' ? 'on a phone' : 'on a computer'}`;
}

/**
 * One finished card, as the Review screen reads it.
 *
 * The parts named in `PLAIN_PARTS` are the card's own words, as the factory sent them. The preview,
 * the pictures and `forJohn` are filled in by the card store (`lib/card-store.ts`) from what the box
 * sent through the door: the preview after it was checked, the pictures as the box took them.
 */
export interface ReviewCardFile {
  /** The ticket it was built for, e.g. ARCA-070. */
  ref: string;
  title: string;
  state: 'finished';
  finishedAt: string;
  /** The version of the work the pictures were taken from. An Accept is bound to it. */
  headSha: string;
  /** A made-up record for tests and demos. The screen says so. */
  demo?: boolean;
  /** The plan's "What this does", in plain English. */
  summary: string;
  changes: { label: string; text: string }[];
  /** Who sees the change once it is part of the product. */
  reaches: string;
  checks: { passed: number; total: number };
  previewUrl: string | null;
  picturesTakenAt: string | null;
  pictures: Partial<Record<PictureName, { width: number; height: number }>>;
  trail: { at: string; tone: Tone; text: string }[];
  /** John's parts. Never sent to a founder. */
  forJohn?: { cost?: string; nextStep?: string; runUrl?: string };
}

export type Tone = 'ok' | 'working' | 'attention' | 'blocked' | 'idle';

/**
 * The last press on a card, when the box let it lapse (FB-278): never collected, or collected and
 * never answered, for 10 minutes. Nothing was done, and the card waits for a decision again.
 */
export interface LapsedPress {
  action: StoredPress['action'];
  by: string;
  /** When it lapsed. */
  at: string;
  /** Ends "Nothing was done.". */
  message: string;
}

/** Where the card stands now, after any presses (FB-276: read from the press store). */
export type CardState =
  | { kind: 'finished'; lapsed?: LapsedPress }
  | { kind: 'signed-off'; by: string; at: string; note: string; lapsed?: LapsedPress }
  | { kind: 'sent-back'; by: string; at: string; note: string; signedOffBy: string | null; answer: BoxAnswer | null }
  | { kind: 'approved'; by: string; at: string; signedOffBy: string | null; answer: BoxAnswer | null }
  /** John's other presses: Stop (a founder's too), Reject, Try again, Split it. From here or from Telegram. */
  | { kind: 'decided'; action: 'stop' | 'reject' | 'try-again' | 'split'; by: string; at: string; note: string; signedOffBy: string | null; answer: BoxAnswer | null };

/**
 * A card's state, from the presses on the version of the work it is about now, oldest first.
 *
 * The press that settles it is the one the box said it did (`done`). Before the box has answered,
 * it is the latest settling press: the one that still stands, or, if the box said each did nothing,
 * the last of those, with its answer. A founder's sign-off before it is remembered.
 *
 * When the latest settling press has lapsed by `now` (FB-278), it settles nothing: the card waits as
 * it did before it, with the lapse beside it. A real answer from the box, however late, wins. A late
 * `done` can leave two presses the box did, the lapsed one and the one pressed after it: the card
 * shows the later, which is the newer decision.
 *
 * `name` turns the address that pressed into what this viewer reads: "you", "John", the founder's
 * name. Done here, on the server, so no address reaches a screen that does not need it. A tap on
 * Telegram says so.
 */
export function stateFrom(presses: StoredPress[], now: number, name: (email: string) => string = (e) => e): CardState {
  const settling = presses.filter((p) => settles(p.action));
  const latest = settling[settling.length - 1] ?? null;
  const done = settling.filter((p) => p.answer?.outcome === 'done');
  const chosen = done[done.length - 1] ?? (latest && !hasLapsed(latest, now) ? latest : null);
  const signOffs = presses.filter((p) => p.action === 'accept' && (!chosen || p.pressedAt <= chosen.pressedAt));
  const signOff = signOffs[signOffs.length - 1] ?? null;
  const who = (p: StoredPress) => (p.source === 'telegram' ? `${name(p.by)} on Telegram` : name(p.by));

  if (!chosen) {
    const lapsed: LapsedPress | undefined = latest
      ? {
        action: latest.action, by: who(latest), at: new Date(lapsesAt(latest) as number).toISOString(),
        message: latest.collectedAt ? NOT_ANSWERED : NOT_COLLECTED,
      }
      : undefined;
    const waiting = lapsed ? { lapsed } : {};
    return signOff ? { kind: 'signed-off', by: who(signOff), at: signOff.pressedAt, note: signOff.note, ...waiting } : { kind: 'finished', ...waiting };
  }
  const base = { by: who(chosen), at: chosen.pressedAt, signedOffBy: signOff ? who(signOff) : null, answer: chosen.answer };
  if (chosen.action === 'send-back') return { kind: 'sent-back', ...base, note: chosen.note };
  if (chosen.action === 'approve') return { kind: 'approved', ...base };
  return { kind: 'decided', action: chosen.action as 'stop' | 'reject' | 'try-again' | 'split', ...base, note: chosen.note };
}

/** Anything but waiting or signed off: the card is no longer waiting for anyone, so nothing more can be pressed. */
export const isSettled = (state: CardState) => state.kind !== 'finished' && state.kind !== 'signed-off';

/** What a press on a settled card is told (harness journey 5). */
export const OUT_OF_DATE = "This card is out of date: the run isn't waiting at it any more. Nothing was done.";

/** One picture, as the screen loads it. */
export interface ReviewPicture {
  name: PictureName;
  width: number;
  height: number;
  src: string;
}

/** Everything the Review screen is given. Built only by `reviewFor`. */
export interface ReviewView {
  ventureId: string;
  ventureName: string;
  repo: string;
  number: number;
  ref: string;
  title: string;
  finishedAt: string;
  headSha: string;
  demo: boolean;
  summary: string;
  changes: { label: string; text: string }[];
  reaches: string;
  checks: { passed: number; total: number };
  preview: PreviewCheck | null;
  picturesTakenAt: string | null;
  pictures: ReviewPicture[];
  trail: { at: string; tone: Tone; text: string; link?: { href: string; label: string } }[];
  state: CardState;
  /** Which of the venture's finished pieces of work this is, and how many there are. */
  place: { index: number; of: number; next: string | null };
  /** Whose screen this is. John is whoever `STUDIO_ADMIN_EMAILS` names. */
  viewer: { isJohn: boolean };
  /**
   * "The factory hasn't reported since 10:42. These may be out of date.", while the planning box has
   * been quiet for five minutes (FB-278). The buttons are off until it reports again.
   */
  quiet: string | null;
  /** John's parts. Present only when the viewer is John. */
  forJohn: { cost: string | null; nextStep: string | null; runUrl: string | null } | null;
}

/**
 * Sentences a founder must never be shown, wherever they turn up: a dollar figure, a "What to do
 * next" line, or anything naming Archon. The factory keeps these in John's parts; this is the second
 * lock, for the day one slips into a summary or a note.
 */
const JOHN_ONLY = [/\$\s?\d/, /what to do next/i, /archon/i];

export function founderSafe(text: string): string {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !JOHN_ONLY.some((re) => re.test(sentence)))
    .join(' ')
    .trim();
}

/**
 * The parts of a card anyone looking at its venture may read, by name (FB-275).
 *
 * The one list. The door keeps these as the card's plain parts and everything else it carried as
 * John's (`lib/factory-door.ts`), and `reviewFor` below reads a card only through it. So a part the
 * factory adds later reaches nobody but John until it is named here: the rule cowgate marks its
 * cards by (CG-0063, "anything not marked founder-safe is treated as John's").
 *
 * Not the last lock. A founder still reads every one of these through `founderSafe`.
 */
export const PLAIN_PARTS = ['ref', 'title', 'finishedAt', 'headSha', 'demo', 'summary', 'changes', 'reaches', 'checks', 'trail'] as const;
export type PlainPart = (typeof PLAIN_PARTS)[number];
export type PlainParts = Pick<ReviewCardFile, PlainPart>;

export const isPlainPart = (key: string): key is PlainPart => (PLAIN_PARTS as readonly string[]).includes(key);

/** Only the parts named in `PLAIN_PARTS`, copied by name. */
export function plainParts(card: PlainParts): PlainParts {
  return Object.fromEntries(PLAIN_PARTS.filter((k) => k in card).map((k) => [k, card[k]])) as unknown as PlainParts;
}

/** The parts of a card a viewer may see. The one place a card is turned into what a screen gets. */
export function reviewFor(
  card: ReviewCardFile,
  at: {
    ventureId: string;
    ventureName: string;
    repo: string;
    number: number;
    preview: PreviewCheck | null;
    state: CardState;
    place: ReviewView['place'];
    viewer: ReviewView['viewer'];
    quiet?: string | null;
  },
): ReviewView {
  const john = at.viewer.isJohn;
  // John reads the card as the factory wrote it. A founder reads it through `founderSafe`.
  const say = (text: string) => (john ? text : founderSafe(text));
  const plain = plainParts(card);
  const base = `/venture/${at.ventureId}/review/${at.repo}/${at.number}`;
  const state = john ? at.state : founderSafeState(at.state);

  return {
    ventureId: at.ventureId,
    ventureName: at.ventureName,
    repo: at.repo,
    number: at.number,
    ref: plain.ref,
    title: say(plain.title) || 'Finished work',
    finishedAt: plain.finishedAt,
    headSha: plain.headSha,
    demo: Boolean(plain.demo),
    summary: say(plain.summary),
    changes: plain.changes
      .map((c) => ({ label: say(c.label), text: say(c.text) }))
      .filter((c) => c.text),
    reaches: say(plain.reaches),
    checks: { passed: plain.checks.passed, total: plain.checks.total },
    preview: at.preview,
    picturesTakenAt: card.picturesTakenAt,
    pictures: PICTURES.flatMap((name) => {
      const p = card.pictures[name];
      return p ? [{ name, width: p.width, height: p.height, src: `${base}/picture/${name}` }] : [];
    }),
    trail: plain.trail
      .map((t) => ({ at: t.at, tone: t.tone, text: say(t.text) }))
      .filter((t) => t.text),
    state,
    place: at.place,
    viewer: at.viewer,
    quiet: at.quiet ?? null,
    forJohn: john
      ? { cost: card.forJohn?.cost ?? null, nextStep: card.forJohn?.nextStep ?? null, runUrl: card.forJohn?.runUrl ?? null }
      : null,
  };
}

/**
 * A note written by John, or the box's answer, shown to a founder goes through the same lock as
 * everything else.
 */
function founderSafeState(state: CardState): CardState {
  const out = 'note' in state ? { ...state, note: founderSafe(state.note) } : state;
  return 'answer' in out && out.answer ? { ...out, answer: { ...out.answer, message: founderSafe(out.answer.message) } } : out;
}

/** A note pinned on one spot of one picture. `x` and `y` are percentages across and down. */
export interface Pin {
  picture: PictureName;
  x: number;
  y: number;
  text: string;
}

/**
 * The one note a Send back (or a sign-off with notes) carries, in words a person reads.
 *
 * Each pin names its picture and its spot, so the team can find it without the screen: "1. On the
 * "after" picture, on a phone, 82% across and 41% down: The button is cut off here."
 */
export function noteFrom(pins: Pin[], whole: string): string {
  const lines = pins
    .filter((p) => p.text.trim())
    .map((p, i) => `${i + 1}. On ${pictureWords(p.picture)}, ${Math.round(p.x)}% across and ${Math.round(p.y)}% down: ${p.text.trim()}`);
  const all = whole.trim();
  if (all) lines.push(lines.length ? `About the whole thing: ${all}` : all);
  return lines.join('\n');
}
