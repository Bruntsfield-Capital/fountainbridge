/**
 * Tickets as one screen (FB-129).
 *
 * ## Why this exists
 *
 * A founder used to read a ticket in one place and decide about it in another — the drawer showed
 * the work, `/attention` held the lever, and nothing on either said the other existed. They had to
 * hold two screens in their head to say yes.
 *
 * This is the pure half of making them one: which tickets a filter contains, what the list says
 * about itself, and — the part that turns three navigations into one sitting — the order decisions
 * are taken in, so "Next decision →" has somewhere to point.
 *
 * Everything here is a pure function of rows the page already loaded. The screen is a view over the
 * board's own data, not a second read of it.
 */

import type { TicketProgress } from './ticket-progress';
import type { TicketStatusGroup, TicketWithMeta } from './tickets';
import type { PrCiStatus } from './attention';

/** The work waiting on a ticket — a pull request carrying finished work, or an external action. */
export interface WaitingOn {
  repo: string;
  number: number;
  /** How long it has waited. Drives the decision order: oldest first, because it has waited longest. */
  ageMs: number;
  /**
   * Further pull requests open on the SAME ticket — a lane retried, or filed a revision.
   *
   * Counted rather than dropped. The row is one row, because it is one piece of work a founder
   * thinks about; the count is what keeps this screen's total equal to the rail's badge, which
   * counts pull requests. A `Map` that simply took the last one seen made the two disagree.
   */
  also?: number;
  /**
   * The commit the founder is being shown.
   *
   * Passed to `acceptWork`, which refuses when something has been pushed since the page rendered.
   * Without it a founder can approve from a list, having never opened the work, and merge a commit
   * that landed after they looked — which is precisely what that parameter exists to prevent.
   */
  headSha?: string | null;
  /**
   * What this venture's own checks said about the work (FB-208).
   *
   * The decision panel printed *"Your team's own checks ran before this reached you"* for every
   * ticket regardless — a sentence the studio had not checked, on the screen where a founder decides
   * whether to accept work. It is the same field the work page reads, so the two cannot disagree.
   *
   * Absent when the studio does not know, which is a different answer from "they passed".
   */
  ciStatus?: PrCiStatus | null;
}

export interface TicketRow {
  /** The ticket id — or `repo#number` for finished work that is tied to no ticket at all. */
  id: string;
  title: string;
  /** The repository this ticket lives in. Two repos in one venture may share an id namespace. */
  repo: string;
  /** The column the board would put it in — inferred status, never the markdown's own claim. */
  group: TicketStatusGroup;
  /**
   * What is actually happening to this ticket, from evidence only (FB-098, moved here by FB-178).
   *
   * This lived on the desk's board and the desk no longer has one. It is the founder's answer to
   * "is anything happening to the thing I asked for" — *picked up 3h ago*, *attempt 2*, *worked,
   * read it and decide* — and it was the half of FB-098 John asked for by name. Removing the board
   * without bringing it here would have deleted the feature and left the tests passing against a
   * screen nobody uses.
   *
   * Null when the studio has no evidence either way, which is different from "nothing is happening".
   */
  progress: TicketProgress | null;
  /**
   * The ticket file, or **null** when there is none.
   *
   * A row with no ticket is not a bug in this screen; it is a fact about the venture. Work sometimes
   * lands that nobody wrote a ticket for, and it still waits on the founder. Leaving it out is how
   * the rail came to say "Needs you 4" over a filter showing 2 — the badge counted what was waiting
   * and the screen counted what happened to have a ticket file.
   */
  item: TicketWithMeta | null;
  /** Non-null when something is waiting on the founder about this ticket. */
  waiting: WaitingOn | null;
  /** The surface it belongs to (Build / Sell / Scale), when the venture declares one. */
  surface: string | null;
  /**
   * Set when this row is an external send waiting on the founder, not a ticket (FB-149).
   *
   * A send is decided on its own page and nowhere else (FB-183), so this carries that page's
   * address. The Tickets screen links to it and never draws an approve control for it.
   */
  send?: SendPointer | null;
  /**
   * Set when this row is, or carries, one of the factory's cards (FB-277).
   *
   * A card is a pull request the factory finished, so a ticket with a card is one row, the card's,
   * and its pull request is not listed again. A card that names no ticket the venture has is a row
   * of its own.
   */
  card?: CardPointer | null;
}

/** A factory card on the Tickets screen: where it stands, and where it is decided. */
export interface CardPointer {
  /** True when it waits on this viewer, so it is in "Needs you" and counted there. */
  waits: boolean;
  standing: string;
  /** Its state, for the meta line: "finished, waiting for your OK". */
  words: string;
  /** What it means, in a sentence, for the detail. */
  sentence: string;
  /** How long it has been in this state, worked out on the server. */
  ageMs: number;
  /** Its Review screen, when it has one. Only a finished card does. */
  href: string | null;
  /** John's parts: null for anyone else, so a founder's page is never sent them. */
  cost: string | null;
  nextStep: string | null;
  /** "The factory hasn't reported since 10:42. …", while the planning box is quiet (FB-278). */
  quiet: string | null;
}

/** An external send on the Tickets screen: where it is decided, and what state it is in. */
export interface SendPointer {
  approvalId: string;
  /** The ticket the send belongs to, when the proposal names one. */
  ref: string | null;
  /** The send's own page — the one place its grant is signed. */
  href: string;
  /** The send's state, which decides what the detail panel can truthfully say about it. */
  status: string;
  /** The meta words for its state, e.g. "tried and did not go". */
  state: string;
  /** True when a grant exists the studio cannot verify. The loudest thing it can say. */
  unverified: boolean;
}

/**
 * The row a URL is asking for, resolved ONCE.
 *
 * Server and client both need it — the server to load that ticket's history, the client to render
 * it — and they resolved it separately, with different fallbacks. So landing on `/tickets` with no
 * `?t=` (which is what the rail's own Tickets row does) rendered a full ticket with **no trail at
 * all**, and a legacy bare-id link could render one ticket's history under another's heading. On the
 * one surface whose claim is that nothing shown can disagree with what ran.
 *
 * Falls back to the first row of the current filter, which is what the screen shows anyway.
 */
export function resolveSelected(rows: TicketRow[], shown: TicketRow[], t: string | null): TicketRow | null {
  if (t) {
    const byKey = rows.find((r) => rowKey(r) === t);
    if (byKey) return byKey;
    // A link written before repositories were part of the key. Resolved against the whole list, not
    // the filtered one, so following an old link never silently lands on a different ticket.
    const byId = rows.find((r) => r.id === t);
    if (byId) return byId;
  }
  return shown[0] ?? null;
}

/**
 * How a row is addressed — by repository AND id.
 *
 * Two repositories in one venture may share an id namespace, so an id alone is not a name. Used for
 * the URL, the selection, the decided set and the decision order, so all four agree.
 */
export const rowKey = (r: Pick<TicketRow, 'repo' | 'id'>): string => `${r.repo}/${r.id}`;

export const TICKET_FILTERS = ['needs', 'all', 'underway', 'settled'] as const;
export type TicketFilter = (typeof TICKET_FILTERS)[number];

/**
 * What Tickets shows when nobody has chosen a filter (FB-185).
 *
 * **"Needs you", not "All"** — and this is a decision, not a default that nobody set.
 *
 * The design's Tickets is a filtered list: it opens on `Needs you (3)` and the other three tabs sit
 * beside it. Ours opened on `All`, which on ARCA's real backlog is 80 tickets, 37 of them finished.
 * That made this the least design-conformant screen in the studio — 7,123px against a design of
 * 1,090px — and FB-178 had just made it the screen a founder uses for the whole queue, because the
 * desk's board was removed on the grounds that Tickets is where the queue lives.
 *
 * A founder opening Tickets is asking "what needs me?". Answering with everything that ever
 * happened is not a smaller version of that answer; it is a different one.
 *
 * Nothing is hidden: the four tabs are unchanged and every finished ticket is one press away under
 * "Done and stopped". The counts beside each tab are of the whole backlog either way, so the screen
 * still says how much there is.
 */
export const DEFAULT_FILTER: TicketFilter = 'needs';

/**
 * The URL's filter, or the default. Never throws: a bookmark with a typo gets the default rather
 * than an error, which is the same thing a founder arriving with no filter at all gets.
 */
export function parseFilter(raw: unknown): TicketFilter {
  return TICKET_FILTERS.includes(raw as TicketFilter) ? (raw as TicketFilter) : DEFAULT_FILTER;
}

/** What a founder calls each filter. One owner for these words. */
export const FILTER_LABEL: Record<TicketFilter, string> = {
  needs: 'Needs you',
  all: 'All',
  underway: 'Underway',
  settled: 'Done and stopped',
};

/**
 * Waiting on the founder.
 *
 * Defined by whether something is ACTUALLY waiting — a pull request they have not read — rather than
 * by the column the ticket sits in. The two agree today and the reason to prefer the first is that
 * only it stays true: a ticket can be moved between columns by anything, and a decision is waiting
 * or it is not.
 */
export const needsFounder = (r: TicketRow): boolean => r.waiting !== null || Boolean(r.send) || Boolean(r.card?.waits);

/**
 * Work in flight: started, not finished, and not waiting on anyone.
 *
 * Defined as "not waiting and not settled" rather than by listing the columns, because listing them
 * left a hole: a ticket whose markdown says "In review" is grouped `pr-open`, and if its pull
 * request has been merged, closed, or simply could not be read (a rate-limited repository returns no
 * pull requests at all), it waits on nobody and is not done. Under a list of columns it appeared in
 * no filter but "All", and `needs + underway + settled` quietly stopped adding up to the total.
 */
export const isUnderway = (r: TicketRow): boolean => !needsFounder(r) && r.group !== 'done';

/** Finished, one way or another. */
export const isSettled = (r: TicketRow): boolean => !needsFounder(r) && r.group === 'done';

export function filterTickets(rows: TicketRow[], filter: TicketFilter): TicketRow[] {
  switch (filter) {
    case 'needs': return rows.filter(needsFounder);
    case 'underway': return rows.filter(isUnderway);
    case 'settled': return rows.filter(isSettled);
    case 'all': return rows;
  }
}

export interface TicketCounts {
  total: number;
  needs: number;
  underway: number;
  settled: number;
}

export const countTickets = (rows: TicketRow[]): TicketCounts => ({
  total: rows.length,
  // Waiting ITEMS, not waiting rows — the rail's badge counts pull requests, and a ticket carrying
  // two of them is two decisions under one heading.
  //
  // A send is one item (FB-149). The badge counts sends as well, so leaving them out here would put
  // the two numbers apart again by exactly the number of sends.
  //
  // A factory card waiting on the founder is one item (FB-277), and the rail counts it the same way.
  needs: rows.reduce((n, r) => n + (r.waiting ? 1 + (r.waiting.also ?? 0) : r.send ? 1 : r.card?.waits ? 1 : 0), 0),
  underway: rows.filter(isUnderway).length,
  settled: rows.filter(isSettled).length,
});

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the list says about itself.
 *
 * Clauses only for what is true, the same rule the desk's summary follows — a founder on day one
 * should read one short sentence rather than three zeroes dressed as a report.
 *
 * The closing claim is deliberate and load-bearing: **every one can be followed to where it changed
 * things.** That is the promise the trail keeps (FB-130), and stating it here is what makes the
 * trail's absence a bug rather than a missing nicety.
 */
export function ticketsSummary(c: TicketCounts, surfaceName?: string | null): string {
  // FB-213: an empty SURFACE is not an empty venture.
  //
  // Filtering to a surface with no work hit the sentence below, and it says "No tickets yet" about
  // the whole company. ARCA has eight; Sell has none. Told to a founder who has just pressed Sell's
  // own link, that is the studio reporting their backlog gone — the FB-137 fault exactly, arriving
  // through a filter instead of through a failed read.
  if (c.total === 0 && surfaceName) {
    return `${surfaceName} has no tickets yet. Other surfaces may — use “Show every surface” above.`;
  }
  if (c.total === 0) return 'No tickets yet. The first one your team files lands here.';

  const parts: string[] = [];
  if (c.needs > 0) parts.push(`${c.needs} waiting on you`);
  if (c.underway > 0) parts.push(`${c.underway} moving`);
  if (c.settled > 0) parts.push(`${c.settled} settled`);

  const breakdown = parts.length
    ? `: ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}`
    : '';
  return `${plural(c.total, 'ticket')}${breakdown}. Every one can be followed to where it changed things.`;
}

/**
 * The order decisions are taken in: oldest first.
 *
 * Oldest rather than newest, because the oldest has waited longest and is the one a founder is most
 * behind on — it is the same ordering the desk's blocker banner counts from, so "the oldest has
 * waited 44 days" and the first decision on this screen are the same piece of work.
 *
 * Ties broken by id so the sequence is stable: a founder deciding three in a row must not have the
 * queue reshuffle underneath them because two arrived in the same second.
 */
export function decisionOrder(rows: TicketRow[]): TicketRow[] {
  // Sends first, the same order the desk's list uses: nothing leaves the company without one, and a
  // send carries no age of its own to sort by (a proposal is a file with no timestamp).
  const rank = (r: TicketRow) => (r.send ? Number.POSITIVE_INFINITY : r.waiting?.ageMs ?? r.card?.ageMs ?? 0);
  return rows
    .filter(needsFounder)
    .slice()
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return rb > ra ? 1 : -1;
      return rowKey(a).localeCompare(rowKey(b));
    });
}

/** "decision 2 of 5", or null when this ticket is not one. */
export function decisionPosition(order: TicketRow[], key: string): { n: number; of: number } | null {
  const i = order.findIndex((r) => rowKey(r) === key);
  return i === -1 ? null : { n: i + 1, of: order.length };
}

/**
 * The next one to decide after this one — the oldest that is not the one just decided.
 *
 * `decided` is passed rather than inferred from the rows, because at the moment this is asked the
 * page has not reloaded: the founder has just approved something and the server does not yet know.
 * Reading the stale rows would offer them the ticket they have already answered.
 */
export function nextDecision(order: TicketRow[], decided: ReadonlySet<string>): TicketRow | null {
  return order.find((r) => !decided.has(rowKey(r))) ?? null;
}

/**
 * What the studio can actually say about the checks on a piece of work (FB-208).
 *
 * The decision panel printed *"Your team's own checks ran before this reached you. Read it in full
 * before deciding."* for **every ticket regardless** — a sentence nobody had checked, on the screen
 * where a founder decides whether to accept work into their product. The review's word for it was
 * that Proven should be a fact.
 *
 * So it says what is known, and says plainly when nothing is. `unknown` and `unavailable` are two
 * different silences and both are honest ones: the first is a piece of work with no checks recorded,
 * the second is the studio failing to read them. Neither is "they passed", and a founder deciding on
 * something irreversible is exactly the reader who must not be told the difference does not matter.
 *
 * The `null` case is the important one. It means the work is not waiting on the founder at all, so
 * there is nothing to prove yet.
 */
export function provenFact(ciStatus: PrCiStatus | null | undefined): string {
  switch (ciStatus) {
    case 'success':
      return 'Your team’s own checks ran on this and passed. Read it in full before deciding.';
    case 'failure':
      return 'Your team’s own checks ran on this and FAILED. Read what failed before deciding.';
    case 'pending':
      return 'Your team’s checks are still running on this. What they say is not known yet.';
    case 'unavailable':
      return 'The studio could not read this venture’s checks, so it cannot tell you what they said.';
    default:
      return 'No checks are recorded against this work, so the studio cannot say it was proven.';
  }
}

/**
 * Which surface a founder asked for, resolved to a repository (FB-213).
 *
 * The three surface columns on the desk each said **"open the queue →"** and all three linked
 * `/tickets` with no filter, so Build, Sell and Scale landed on the same screen. A founder pressing
 * Sell's and getting Build's work was told something untrue by a control the studio drew — the same
 * class as FB-138's `?work=` parameter that nothing read, and worse than a missing link, because
 * there is no way to tell it did not work.
 *
 * **Accepts either name**, because two kinds of queue link here. A department has a founder-facing
 * id (`build`, `sell`, `scale`) and that is what belongs in a URL; a lane with no department — an
 * "other queue" — has only its repository. Resolving both through one parameter keeps this one
 * mechanism rather than two that do not know about each other.
 *
 * Returns `null` for anything it cannot resolve, and the caller shows the unfiltered list. An
 * unknown surface must not show an empty screen: that would read as "this surface has no work",
 * which is a claim about the venture made from a typo in a URL.
 */
export function resolveSurface(
  asked: string | undefined,
  departments: ReadonlyArray<{ id: string; repo: string }>,
  knownRepos: ReadonlyArray<string>,
): string | null {
  const want = asked?.trim().toLowerCase();
  if (!want) return null;
  const byId = departments.find((d) => d.id.toLowerCase() === want);
  if (byId) return byId.repo;
  return knownRepos.find((r) => r.toLowerCase() === want) ?? null;
}

/**
 * The rows of one surface.
 *
 * Applied BEFORE the status filter, not after: the two narrow different things — which part of the
 * company, and which state its work is in — and a founder who picks Sell then "Needs you" means
 * both. Doing it in the other order gives the same answer here, but only because both are pure
 * filters; stating the order stops the next person assuming it cannot matter.
 */
export function onSurface(rows: readonly TicketRow[], repo: string | null): TicketRow[] {
  return repo === null ? [...rows] : rows.filter((r) => r.repo === repo);
}
