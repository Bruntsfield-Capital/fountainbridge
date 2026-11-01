/**
 * The factory's cards in the lists a founder already has (FB-277): the desk's "Waiting on you", the
 * Tickets screen's "Needs you", the rail's count, and "What happened".
 *
 * There is no factory page. A card is a piece of work, so it is a row in the lists that already
 * hold work. This file says, for one card and one viewer:
 *
 *   - where the card stands, from the box's state and the presses on it (`standingOf`);
 *   - whether it waits on this viewer, so it is counted in "Needs you" (`waitsOn`);
 *   - the row it is in a list (`cardRow`), and the lines it adds to "What happened" (`cardEvents`);
 *   - which pull requests read from GitHub are the same work, so a list shows one row, the card's,
 *     never two (`isSameWork`, `withoutCarded`).
 *
 * A founder reads only the card's plain parts, and those through `founderSafe` (lib/review.ts),
 * here as on the Review screen. John also gets his parts: what the run cost and what to do next.
 * Both are decided here, on the server, so a founder's browser never receives John's.
 *
 * Pure: no reads, no clock. The loader is `lib/factory-work-load.ts`.
 */

import { founderSafe, stateFrom, type CardState, type PlainParts } from './review';
import type { StoredCard } from './card-store';
import type { StoredPress } from './presses';
import type { Tone } from './status';

/**
 * The factory's own cards: cowgate's, the repository the factory itself is built in.
 *
 * Kept under a venture id no manifest can have (ids are lower-case letters, digits and dashes,
 * and `loadVentures` skips any that starts with `_`). So no founder's `requireVenture` can reach
 * it, and the database's row-level security keeps it apart from every venture's cards. Only John
 * sees these, on his own cross-venture pages.
 */
export const FACTORY_VENTURE = '_factory';
/** The factory's own repository, `wealthcx01/cowgate`, by its short name. */
export const FACTORY_REPO = 'cowgate';
/** What the factory is called on John's pages, where a venture's name would go. */
export const FACTORY_NAME = 'The factory';

/** One card as the store gives it back, with the presses on the version of the work it is about. */
export interface LoadedCard {
  ventureId: string;
  card: StoredCard;
  presses: StoredPress[];
  /** When the store was read. Whether a press has lapsed (FB-278) is judged at this instant. */
  readAt: number;
}

/**
 * Where a card stands, in one word.
 *
 * The box's own states are `finished`, `stuck`, `sent-back`, `done`, `failed` and `needs-you`. A
 * finished card then moves on with the presses made on it (FB-276): signed off, sent back,
 * approved (and then done, once the box says so), stopped, turned down, tried again, split, or
 * "nothing was done" when the box said a press came too late.
 */
export type Standing =
  | 'finished' | 'signed-off' | 'stuck' | 'sent-back' | 'needs-you'
  | 'approved' | 'done' | 'failed' | 'stopped' | 'rejected' | 'trying-again' | 'split' | 'nothing-done';

/** Who is looking, and how to name the people who pressed. */
export interface Viewer {
  isJohn: boolean;
  /** An address, in the words this viewer reads: "you", "John", the founder's name. */
  name: (email: string) => string;
}

/** Who pressed, in the words this viewer reads. The same rule the Review screen uses. */
export function namer(viewerEmail: string, admins: readonly string[], founder: { email: string | null; name: string | null }) {
  const lowerAdmins = admins.map((a) => a.toLowerCase());
  return (email: string): string => {
    const e = email.toLowerCase();
    if (e === viewerEmail.toLowerCase()) return 'you';
    if (lowerAdmins.includes(e)) return 'John';
    if (founder.email && e === founder.email.toLowerCase()) return founder.name ?? 'the founder';
    return email;
  };
}

/**
 * Where the card stands now, and since when.
 *
 * The box's state comes first. Once the box sends a card as done, stuck or anything else, that is
 * where the work is, whatever was pressed on the version before. Only a card the box calls
 * finished is moved on by presses, and that is read with `stateFrom`, the Review screen's own rule,
 * so this list and that screen cannot disagree about one card.
 */
export function standingOf(lc: LoadedCard, name: Viewer['name'] = (e) => e): { standing: Standing; state: CardState | null; at: string } {
  const { card, presses } = lc;
  if (card.state !== 'finished') return { standing: card.state, state: null, at: card.sentAt };
  const state = stateFrom(presses, lc.readAt, name);
  switch (state.kind) {
    case 'finished':
      return { standing: 'finished', state, at: state.lapsed?.at ?? (card.plain.finishedAt || card.sentAt) };
    case 'signed-off':
      return { standing: 'signed-off', state, at: state.at };
    default: {
      const answer = state.answer;
      const at = answer?.at ?? state.at;
      if (answer && answer.outcome !== 'done') return { standing: 'nothing-done', state, at };
      if (state.kind === 'sent-back') return { standing: 'sent-back', state, at };
      if (state.kind === 'approved') return { standing: answer ? 'done' : 'approved', state, at };
      const byAction = { stop: 'stopped', reject: 'rejected', 'try-again': 'trying-again', split: 'split' } as const;
      return { standing: byAction[state.action], state, at };
    }
  }
}

/**
 * Whether a card waits on this viewer, and so is a row of their "Needs you" and part of its count.
 *
 * Finished, stuck and sent-back cards wait on whoever looks at the venture (the PRD's three
 * states). A card a founder has signed off, or one the box marked as needing John, waits on John
 * alone: for the founder it is in "What happened", not in their count.
 */
export function waitsOn(standing: Standing, isJohn: boolean): boolean {
  if (standing === 'finished' || standing === 'stuck' || standing === 'sent-back') return true;
  if (standing === 'signed-off' || standing === 'needs-you') return isJohn;
  return false;
}

/** The card's state, as the few words a row's meta line carries. */
export function standingWords(standing: Standing, state: CardState | null, viewer: Pick<Viewer, 'isJohn'>, ventureName: string): string {
  switch (standing) {
    case 'finished': return 'finished, waiting for your OK';
    case 'signed-off': {
      const by = state && 'by' in state ? state.by : 'the founder';
      return viewer.isJohn ? `signed off by ${by}, waiting for you` : `signed off by ${by}, waiting for John`;
    }
    case 'stuck': return 'stuck, needs a person';
    case 'sent-back': return 'sent back, your team is on it';
    case 'needs-you': return viewer.isJohn ? 'needs your OK' : 'waiting for John';
    case 'approved': return `approved, becoming part of ${ventureName}`;
    case 'done': return `part of ${ventureName}`;
    case 'failed': return 'your team could not finish it';
    case 'stopped': return 'stopped';
    case 'rejected': return 'turned down';
    case 'trying-again': return 'being tried again';
    case 'split': return 'being split into smaller pieces';
    case 'nothing-done': return 'nothing was done';
  }
}

/** John's parts of a card, for his eyes only. The same two lines Telegram shows him. */
export function johnLines(card: StoredCard): { cost: string | null; nextStep: string | null } {
  const john = (card.forJohn.forJohn ?? {}) as Record<string, unknown>;
  const line = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { cost: line(john.cost), nextStep: line(john.nextStep) };
}

/** A card, as a row of a list. Everything in it is safe for this viewer's browser. */
export interface CardRow {
  /** `repo#number`: one card per pull request. */
  key: string;
  ventureId: string;
  repo: string;
  number: number;
  /** The ticket it was built for, e.g. ARCA-070, or '' when the card names none. */
  ref: string;
  title: string;
  standing: Standing;
  /** True when it waits on this viewer: a row of their "Needs you", and counted there. */
  waits: boolean;
  /** The state in words, for the meta line: "finished, waiting for your OK". */
  words: string;
  /** When it reached this state. */
  at: string;
  /** Its Review screen, for a finished card of a venture's. Null for every other card. */
  href: string | null;
  /** John's two lines. Null for anyone else, so a founder's page is never sent them. */
  john: { cost: string | null; nextStep: string | null } | null;
}

/** The Review screen of one card, or null when it has none (only a finished card has one). */
export function reviewHref(lc: LoadedCard): string | null {
  if (lc.card.state !== 'finished' || lc.ventureId === FACTORY_VENTURE) return null;
  return `/venture/${lc.ventureId}/review/${lc.card.repo}/${lc.card.number}`;
}

/** The words a viewer may read of one plain part. John reads the card as the factory wrote it. */
const sayer = (viewer: Pick<Viewer, 'isJohn'>) => (text: string) => (viewer.isJohn ? text : founderSafe(text));

/** A title to put in a sentence. Never empty, never John's words for a founder. */
function titleOf(plain: PlainParts, viewer: Pick<Viewer, 'isJohn'>): string {
  return sayer(viewer)(plain.title ?? '').trim() || 'A piece of work';
}

/** What a card becomes part of once it is done: the venture, or for cowgate's, the factory itself. */
const productOf = (lc: LoadedCard, ventureName: string) => (lc.ventureId === FACTORY_VENTURE ? 'the factory' : ventureName);

export function cardRow(lc: LoadedCard, viewer: Viewer, ventureName: string): CardRow {
  const { standing, state, at } = standingOf(lc, viewer.name);
  const { card } = lc;
  return {
    key: `${card.repo}#${card.number}`,
    ventureId: lc.ventureId,
    repo: card.repo,
    number: card.number,
    ref: card.plain.ref ?? '',
    title: titleOf(card.plain, viewer),
    standing,
    waits: waitsOn(standing, viewer.isJohn),
    words: standingWords(standing, state, viewer, productOf(lc, ventureName)),
    at,
    href: reviewHref(lc),
    john: viewer.isJohn ? johnLines(card) : null,
  };
}

/** Waiting cards first, oldest first, as the queues order work; then the rest, newest first. */
export function cardRows(cards: readonly LoadedCard[], viewer: Viewer, ventureName: (ventureId: string) => string): CardRow[] {
  const rows = cards.map((c) => cardRow(c, viewer, ventureName(c.ventureId)));
  const waiting = rows.filter((r) => r.waits).sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
  const rest = rows.filter((r) => !r.waits).sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  return [...waiting, ...rest];
}

/**
 * How the Tickets screen addresses a card's row: by its ticket when it names one, which is the same
 * row as that ticket's when the venture has its file, and by `repo#number` when it names none.
 */
export const cardTicketId = (row: Pick<CardRow, 'ref' | 'key'>): string => row.ref || row.key;

/** Where a card's row leads: its Review screen when it has one, otherwise its row on Tickets. */
export function cardHref(row: CardRow): string {
  if (row.href) return row.href;
  return `/venture/${row.ventureId}/tickets?filter=needs&t=${encodeURIComponent(`${row.repo}/${cardTicketId(row)}`)}`;
}

/** What a card's state means, in a sentence, for the Tickets screen's detail. */
export function cardSentence(row: Pick<CardRow, 'standing' | 'href'>, isJohn: boolean): string {
  switch (row.standing) {
    case 'finished':
      return row.href
        ? 'Your team finished this. Look at it before and after, on a computer and on a phone, then decide.'
        : 'Your team finished this, and it waits for a decision.';
    case 'signed-off': return isJohn ? 'The founder signed this off. It waits for your OK.' : 'You signed this off. It waits for John, whose OK makes it part of your product.';
    case 'stuck': return 'Your team got stuck on this and stopped. It needs a person to decide how it goes on.';
    case 'sent-back': return 'This went back to your team with a note. They are working on it again.';
    case 'needs-you': return isJohn ? 'This waits for your OK.' : 'This waits for John’s OK. Nothing is needed from you.';
    case 'approved': return 'This is approved. It becomes part of your product next.';
    case 'done': return 'This is part of your product.';
    case 'failed': return 'Your team could not finish this.';
    case 'stopped': return 'This was stopped. Nothing more happens to it.';
    case 'rejected': return 'This was turned down. Nothing more happens to it.';
    case 'trying-again': return 'Your team is trying this again.';
    case 'split': return 'Your team is splitting this into smaller pieces.';
    case 'nothing-done': return 'Nothing was done: it had already moved on when the decision reached your team.';
  }
}

/** The column a card belongs in on Tickets: waiting, still moving, or finished one way or another. */
export function cardGroup(row: Pick<CardRow, 'waits' | 'standing'>): 'pr-open' | 'in-progress' | 'done' {
  if (row.waits) return 'pr-open';
  return row.standing === 'approved' || row.standing === 'trying-again' || row.standing === 'split' || row.standing === 'signed-off' || row.standing === 'needs-you'
    ? 'in-progress'
    : 'done';
}

/** "Build · finished, waiting for your OK", and for John his cost after it. One line. */
export function metaLine(row: CardRow, surface: string | null): string {
  return [surface, row.words, row.john?.cost].filter(Boolean).join(' · ');
}

// ---- The same work, read twice ------------------------------------------------------------------

/** What a pull request read from GitHub is known by. */
export interface WorkRef {
  repo: string;
  number: number;
  /** The ticket it is tied to, when it is tied to one. */
  linkedTicketId?: string | null;
}

/**
 * Whether a pull request read from GitHub and a card are the same piece of work.
 *
 * A card is one pull request, so the same repository and number is the same work. So is the same
 * ticket in the same repository: the box may have opened a new pull request for a ticket whose card
 * the studio already has, and two rows for one ticket would be two decisions where there is one.
 * The repository has to match too, because two repositories in a venture may share ticket ids.
 */
export function isSameWork(pr: WorkRef, card: Pick<CardRow, 'repo' | 'number' | 'ref'>): boolean {
  if (pr.repo !== card.repo) return false;
  if (pr.number === card.number) return true;
  const ref = card.ref.trim().toLowerCase();
  return ref !== '' && (pr.linkedTicketId ?? '').trim().toLowerCase() === ref;
}

/**
 * The pull requests no card stands for. Wherever both are listed, the card's row is the one shown.
 *
 * Every card counts here, waiting or not: a card John approved and the box answered done is no
 * longer waiting, and the pull request GitHub still reads as open must not come back in its place.
 */
export function withoutCarded<T extends WorkRef>(prs: readonly T[], cards: readonly Pick<CardRow, 'repo' | 'number' | 'ref'>[]): T[] {
  return prs.filter((pr) => !cards.some((c) => isSameWork(pr, c)));
}

/** How many of these cards wait on the viewer. Added to the open work in every "Needs you" count. */
export const cardsWaiting = (rows: readonly CardRow[]): number => rows.filter((r) => r.waits).length;

/**
 * The ticket ids of stuck cards, for the desk's stuck line. Its name stands in where there is no id.
 * The stuck line already names tickets its team could not finish, so a stuck card joins that line
 * rather than starting a second one.
 */
export const stuckNames = (rows: readonly CardRow[]): { id: string; title: string }[] =>
  rows.filter((r) => r.standing === 'stuck').map((r) => ({ id: cardTicketId(r), title: r.title }));

// ---- What happened ------------------------------------------------------------------------------

/** One line a card adds to "What happened". */
export interface CardEvent {
  at: string;
  text: string;
  tone: Tone;
  ventureId: string;
  repo: string;
  number: number;
  ref: string;
  /** Where the line leads: the card's Review screen, when it has one. */
  href: string | null;
  /** What the run cost. John's only: null for anyone else. */
  cost: string | null;
}

const capital = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** What each press did, as the verb after a name: "John approved …". */
const PRESS_VERB: Record<StoredPress['action'], string> = {
  stop: 'stopped',
  'send-back': 'sent back',
  accept: 'signed off',
  approve: 'approved',
  reject: 'turned down',
  'try-again': 'asked your team to try again on',
  split: 'asked your team to split up',
};

/**
 * The lines one card adds to "What happened", each with its own time.
 *
 * The card itself is one line: what the box last said about it. Each press is one more, with the
 * name of who pressed. When the box says what a press did, that is its own line, at its own time,
 * in the box's words: "The auctions view: Made part of ARCA." A tap on Telegram is already
 * answered when it arrives, so it is one line with its answer, not two saying the same thing.
 */
export function cardEvents(lc: LoadedCard, viewer: Viewer, ventureName: string): CardEvent[] {
  const { card } = lc;
  const title = titleOf(card.plain, viewer);
  const say = sayer(viewer);
  const { standing, state } = standingOf(lc, viewer.name);
  const base = {
    ventureId: lc.ventureId, repo: card.repo, number: card.number, ref: card.plain.ref ?? '',
    href: reviewHref(lc), cost: viewer.isJohn ? johnLines(card).cost : null,
  };

  const own = ((): { text: string; tone: Tone } => {
    switch (card.state) {
      case 'finished':
        return { text: `Your team finished ${title}.${standing === 'finished' ? ' It waits for your OK.' : ''}`, tone: standing === 'finished' ? 'attention' : 'ok' };
      case 'stuck': return { text: `Your team got stuck on ${title}. It needs a person.`, tone: 'attention' };
      case 'sent-back': return { text: `${title} went back to your team, who are working on it again.`, tone: 'working' };
      case 'done': return { text: `${title} became part of ${productOf(lc, ventureName)}.`, tone: 'ok' };
      case 'failed': return { text: `Your team could not finish ${title}.`, tone: 'blocked' };
      case 'needs-you': return viewer.isJohn
        ? { text: `${title} needs your OK.`, tone: 'attention' }
        : { text: `${title} waits for John's OK.`, tone: 'idle' };
    }
  })();
  const events: CardEvent[] = [{ ...base, at: card.state === 'finished' ? card.plain.finishedAt || card.sentAt : card.sentAt, ...own }];

  for (const p of lc.presses) {
    const who = capital(viewer.name(p.by));
    const telegram = p.source === 'telegram';
    const did = p.answer && p.answer.outcome !== 'done' ? ' Nothing was done.' : '';
    const waits = p.action === 'accept' ? (viewer.isJohn ? ' It waits for you.' : ' It waits for John.') : '';
    events.push({
      ...base,
      at: p.pressedAt,
      text: `${who}${telegram ? ' on Telegram' : ''} ${PRESS_VERB[p.action]} ${title}.${telegram ? did : waits}`,
      tone: p.action === 'accept' || p.action === 'approve' ? 'ok' : p.action === 'send-back' ? 'working' : 'idle',
    });
    if (p.answer && !telegram) {
      const message = say(p.answer.message).trim();
      if (message) {
        events.push({ ...base, at: p.answer.at, text: `${title}: ${message}`, tone: p.answer.outcome === 'done' ? 'ok' : 'idle' });
      }
    }
  }
  const lapsed = state && 'lapsed' in state ? state.lapsed : undefined;
  if (lapsed) events.push({ ...base, at: lapsed.at, text: `${title}: ${lapsed.message}`, tone: 'attention' });
  return events;
}
