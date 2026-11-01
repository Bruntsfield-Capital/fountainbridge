import type { VentureSummary } from './ventures';
import type { CardStore } from './card-store';
import { OUT_OF_DATE } from './review';
import { pressRecordFile, recordPress, type PressLine } from './press-record';
import { isPressAction, mayPress, quietLine, quietSince, reportedWhen, type PressAction } from './presses';
import { DEFAULT_BOX } from './factory-door';

/**
 * The studio's side of a press on a factory card (FB-276).
 *
 * The studio checks who pressed and records it. It never calls Archon or GitHub for a factory card:
 * the planning box collects the press through its door and runs it through the same code as a tap
 * on Telegram (PRD, "What a press does").
 *
 * Whoever calls this has already checked the session and the venture (`requireVenture`, or
 * `authorizeVentures` and `canAccessVenture`), and that the repository is one of the venture's own.
 * In order, after that:
 *
 *   1. The card must be this venture's. The store is read scoped to this venture, so another
 *      venture's card gets exactly the answer a missing card gets.
 *   2. The press must be one this person may make. A founder may press Stop, Send back and Accept;
 *      only John has Approve, Reject, Try again and Split it. A refused press is never recorded, so
 *      the box can never collect it. It is written as one line to the studio's log instead.
 *   3. The factory must be reporting (FB-278). While it has been quiet for five minutes, nothing is
 *      recorded: a press it cannot see would look as if it had worked.
 *   4. The first press wins, and the press must be on the version of the work the page showed. The
 *      store checks both and records the press in one transaction, with the card's row locked. A
 *      press the factory let lapse no longer counts as the first.
 *
 * In a test copy each recorded press is also written as one line to its state folder
 * (`lib/press-record.ts`), because `harness/END-TO-END.md` says so.
 */

export interface PressResult {
  ok: boolean;
  message: string;
  /** True when a founder's Accept was recorded as their sign-off. */
  signedOff?: boolean;
}

export interface Presser {
  email: string;
  /** Whoever `STUDIO_ADMIN_EMAILS` names. Never anything the browser said. */
  isJohn: boolean;
}

export interface PressDeps {
  store: CardStore;
  /** The test copy's line file, or null outside the test rig. */
  recordFile: string | null;
  log: (line: string) => void;
  now: () => Date;
}

/** The studio's own: its store, the test copy's line file when there is one, and its log. */
export function pressDeps(store: CardStore, env: Record<string, string | undefined> = process.env): PressDeps {
  return { store, recordFile: pressRecordFile(env), log: (line) => console.warn(`[press] ${line}`), now: () => new Date() };
}

/** What a missing card, and another venture's, is told. One sentence for both. */
export const NOT_FOUND = 'That work could not be found.';
export const CHANGED = 'This work changed after the page loaded, so nothing was done. Refresh and look again.';
export const ONLY_JOHN = 'Only John can do that. Nothing was recorded.';
/** How long a note may be. Long enough for a paragraph; short enough that it is a note. */
export const NOTE_LIMIT = 2000;

/** What each recorded press is told. */
const DONE: Record<PressAction, string> = {
  'send-back': 'Sent back with your notes. Your team picks them up next.',
  accept: 'Signed off by you, waiting for John. Nothing changes in your product until he approves it.',
  approve: 'Approved. The factory makes it part of the product next, and this page says when it has.',
  reject: 'Rejected. The factory closes this work next, and this page says when it has.',
  'try-again': 'Sent to try again. The factory starts it again next, and this page says when it has.',
  split: 'Sent to be split. The factory breaks it into smaller pieces next, and this page says when it has.',
  stop: 'Stop sent. The factory stops this work next, and this page says when it has.',
};

/** What the test copy's line file calls each press. A founder's Accept is a sign-off. */
const LINE: Record<PressAction, PressLine['decision']> = {
  'send-back': 'sent-back', accept: 'signed-off', approve: 'approved', reject: 'rejected',
  'try-again': 'try-again', split: 'split', stop: 'stopped',
};

/**
 * When the planning box last reported, if it has been quiet for five minutes (FB-278). Null while it
 * reports, and before it ever has: a box never heard from has not gone quiet.
 */
export async function factoryQuietSince(store: CardStore, now: number): Promise<string | null> {
  return quietSince((await store.lastBeat(DEFAULT_BOX))?.reportedAt ?? null, now);
}

/** The line a card shows while the factory is quiet, or null while it reports. */
export async function factoryQuietLine(store: CardStore, now: number): Promise<string | null> {
  const since = await factoryQuietSince(store, now);
  return since ? quietLine(since, now) : null;
}

/** What a press made while the factory is quiet is told. */
export const quietRefusal = (since: string, now: number) =>
  `The factory hasn't reported since ${reportedWhen(since, now)}, so nothing was recorded. Try again once it is back.`;

/**
 * Whether this is a factory card, for the presses that also have a GitHub path (`acceptWork`,
 * `sendBackWork`). A card in any state counts: the studio never calls GitHub for one.
 */
export async function isFactoryCard(store: CardStore | null, venture: VentureSummary, repo: string, number: number): Promise<boolean> {
  return store !== null && (await store.card(venture.id, repo, number)) !== null;
}

export async function pressCard(
  deps: PressDeps,
  venture: VentureSummary,
  who: Presser,
  repo: string,
  number: number,
  asked: unknown,
  opts: { note?: unknown; seenHeadSha?: unknown } = {},
): Promise<PressResult> {
  if (!isPressAction(asked)) return { ok: false, message: 'That is not something the studio can do to a card.' };
  if (!Number.isInteger(number) || number <= 0) return { ok: false, message: NOT_FOUND };
  // John's Accept is his Approve: he has no sign-off to give.
  const action: PressAction = asked === 'accept' && who.isJohn ? 'approve' : asked;
  const note = typeof opts.note === 'string' ? opts.note.trim() : '';
  if (note.length > NOTE_LIMIT) return { ok: false, message: `That note is too long. Keep it under ${NOTE_LIMIT} characters.` };
  if (action === 'send-back' && !note) return { ok: false, message: 'Say what needs changing, and it goes straight to your team.' };
  const seen = typeof opts.seenHeadSha === 'string' && opts.seenHeadSha ? opts.seenHeadSha : null;

  if (!(await deps.store.card(venture.id, repo, number))) return { ok: false, message: NOT_FOUND };

  if (!mayPress(action, who.isJohn)) {
    // Not recorded, so nothing can collect it. One line, so John can see who tried what.
    deps.log(`refused: ${who.email} pressed ${action} on ${venture.id} ${repo}#${number}, which only John may press. Nothing was recorded.`);
    return { ok: false, message: ONLY_JOHN };
  }

  const now = deps.now().getTime();
  const quiet = await factoryQuietSince(deps.store, now);
  if (quiet) return { ok: false, message: quietRefusal(quiet, now) };

  const by = who.email.toLowerCase();
  const kept = await deps.store.press(venture.id, { repo, number, action, by, byJohn: who.isJohn, note, seenHeadSha: seen });
  if (kept === 'no-card') return { ok: false, message: NOT_FOUND };
  if (kept === 'out-of-date') return { ok: false, message: OUT_OF_DATE };
  if (kept === 'changed') return { ok: false, message: CHANGED };
  if (kept === 'already-signed-off') return { ok: true, signedOff: true, message: 'You have already signed this off. It is waiting for John.' };

  if (deps.recordFile) {
    recordPress(deps.recordFile, { at: deps.now().toISOString(), venture: venture.id, repo, number, by, decision: LINE[action], note, seen });
  }
  return action === 'accept' ? { ok: true, signedOff: true, message: DONE.accept } : { ok: true, message: DONE[action] };
}
