import { describe, it, expect } from 'vitest';
import {
  FILTER_LABEL, countTickets, decisionOrder, decisionPosition, filterTickets, nextDecision,
  DEFAULT_FILTER, onSurface, parseFilter, provenFact, resolveSurface, rowKey, ticketsSummary,
  type TicketRow,
  ROW_STATUS_LABEL, rowStatus, isSettled,
} from '../tickets-view';
import type { TicketStatusGroup } from '../tickets';

/**
 * Tickets as one screen (FB-129).
 *
 * The load-bearing property is the decision ORDER: a founder clearing three in a row must get the
 * oldest each time, must not be offered one they have just answered, and must not have the sequence
 * reshuffle underneath them.
 */

let n = 0;
const row = (over: Partial<TicketRow> & { group?: TicketStatusGroup } = {}): TicketRow => {
  const id = over.id ?? `ARCA-${String(++n).padStart(3, '0')}`;
  return {
    id,
    title: over.title ?? `Ticket ${id}`,
    repo: over.repo ?? 'arca',
    group: over.group ?? 'todo',
    progress: over.progress ?? null,
    surface: over.surface ?? 'Build',
    waiting: over.waiting ?? null,
    item: over.item === null ? null : ({ ticket: { id, title: `Ticket ${id}` }, warnings: [] } as unknown as TicketRow['item']),
  };
};
const waiting = (ageMs: number, also = 0) => ({ repo: 'arca', number: 1, ageMs, also });

describe('which tickets a filter contains', () => {
  const rows = [
    row({ id: 'A', group: 'pr-open', waiting: waiting(3_000) }),
    row({ id: 'B', group: 'in-progress' }),
    row({ id: 'C', group: 'todo' }),
    row({ id: 'D', group: 'done' }),
    row({ id: 'E', group: 'filed' }),
  ];

  it('“Needs you” is what is actually waiting, not what column it sits in', () => {
    // A ticket can be moved between columns by anything. A decision is waiting or it is not.
    expect(filterTickets(rows, 'needs').map((r) => r.id)).toEqual(['A']);
  });

  it('“Being built” is only work with evidence behind it, never a ticket file saying “In progress” (FB-296)', () => {
    expect(filterTickets(rows, 'underway').map((r) => r.id)).toEqual([]);
    const moving = row({ id: 'F', group: 'in-progress', progress: { state: 'working', text: 'Your team picked this up 5 minutes ago.', tone: 'working' } });
    expect(filterTickets([...rows, moving], 'underway').map((r) => r.id)).toEqual(['F']);
  });

  it('“Not started” is everything else that is not waiting and not finished (FB-296)', () => {
    expect(filterTickets(rows, 'todo').map((r) => r.id)).toEqual(['B', 'C', 'E']);
  });

  it('“Done and stopped” is what is finished', () => {
    expect(filterTickets(rows, 'settled').map((r) => r.id)).toEqual(['D']);
  });

  it('“All” hides nothing', () => {
    expect(filterTickets(rows, 'all')).toHaveLength(5);
  });

  it('counts two pull requests on one ticket as two decisions under one heading', () => {
    // The rail's badge counts pull requests. A Map that took whichever came last showed one row and
    // let the badge say 2 while the filter said 1 — the exact disagreement this screen closed.
    const doubled = [row({ id: 'TWICE', group: 'pr-open', waiting: waiting(9, 1) })];
    expect(filterTickets(doubled, 'needs')).toHaveLength(1);
    expect(countTickets(doubled).needs).toBe(2);
  });

  it('a ticket in review whose pull request cannot be read still appears somewhere', () => {
    // Grouped `pr-open` by its own markdown, with no open pull request — merged, closed, or the
    // repository was rate-limited and returned none. Under a list of columns it appeared in no
    // filter but "All", and the three counts stopped adding up to the total.
    const orphaned = [row({ id: 'REVIEW', group: 'pr-open' })];
    expect(filterTickets(orphaned, 'todo').map((r) => r.id)).toEqual(['REVIEW']);
    const c = countTickets(orphaned);
    expect(c.needs + c.underway + c.todo + c.settled).toBe(c.total);
  });

  it('a ticket waiting on the founder is never also counted as underway', () => {
    // Otherwise the filters add up to more than the list, and a founder counts the same work twice.
    // (`needs` counts waiting ITEMS, so this holds only while no ticket carries two — which is what
    // the test above is for.)
    const c = countTickets(rows);
    expect(c.needs + c.underway + c.todo + c.settled).toBe(c.total);
  });

  it('counts work that has no ticket file, because it still waits on the founder', () => {
    // The rail said "Needs you 4" over a filter showing 2: the badge counted what was waiting and
    // the screen counted what happened to have a ticket. Finished work nobody wrote a ticket for is
    // a fact about the venture, not a row to leave out.
    const withOrphan = [...rows, row({ id: 'arca#12', item: null, group: 'pr-open', waiting: waiting(1) })];
    expect(filterTickets(withOrphan, 'needs').map((r) => r.id)).toEqual(['A', 'arca#12']);
    expect(countTickets(withOrphan).needs).toBe(2);
  });

  it('reads a filter out of a URL, and shrugs at a typo', () => {
    expect(parseFilter('needs')).toBe('needs');
    expect(parseFilter('settled')).toBe('settled');
    expect(parseFilter('all')).toBe('all');
    expect(FILTER_LABEL.needs).toBe('Needs you');
  });

  /**
   * FB-185: the default is a decision, so it is pinned.
   *
   * Tickets opened on `All` — every ticket the venture ever had, 80 of them on ARCA, 37 finished —
   * against a design that opens on `Needs you`. Changing this back should have to argue with a test
   * rather than pass quietly.
   */
  it('opens on what needs the founder, not on everything that ever happened', () => {
    expect(DEFAULT_FILTER).toBe('needs');
    expect(parseFilter(undefined)).toBe('needs');
    expect(parseFilter('')).toBe('needs');
    expect(parseFilter('nonsense')).toBe('needs');
  });

  it('the default filter shows only what is waiting on the founder', () => {
    // The whole point of the default: it must not be a synonym for "all".
    expect(filterTickets(rows, DEFAULT_FILTER)).toEqual(filterTickets(rows, 'needs'));
    expect(filterTickets(rows, DEFAULT_FILTER).length).toBeLessThan(rows.length);
  });
});

describe('what the list says about itself', () => {
  it('reads as the design writes it', () => {
    const rows = [
      ...[1, 2, 3].map(() => row({ group: 'pr-open', waiting: waiting(1) })),
      ...[1, 2].map(() => row({ group: 'in-progress', progress: { state: 'working', text: 'Your team is on this.', tone: 'working' } })),
      row({ group: 'todo' }),
      ...[1, 2, 3, 4].map(() => row({ group: 'done' })),
    ];
    expect(ticketsSummary(countTickets(rows))).toBe(
      '10 tickets: 3 waiting on you, 2 being built, 1 not started and 4 done or stopped. Every one can be followed to where it changed things.',
    );
  });

  it('drops the clauses that are not true rather than reporting zeroes', () => {
    expect(ticketsSummary(countTickets([row({ group: 'done' })])))
      .toBe('1 ticket: 1 done or stopped. Every one can be followed to where it changed things.');
  });

  it('says something useful when there is nothing at all', () => {
    expect(ticketsSummary(countTickets([]))).toBe('No tickets yet. The first one your team files lands here.');
  });
});

describe('two repositories in one venture may share an id namespace', () => {
  it('addresses a row by repository as well as id', () => {
    // `FB-001` in one repo is not `FB-001` in another. Dropping the repo made the second one
    // unreachable, highlighted both rows at once, and let approving one mark the other decided.
    const a = row({ id: 'FB-001', repo: 'arca', group: 'pr-open', waiting: waiting(9) });
    const b = row({ id: 'FB-001', repo: 'arca-ops', group: 'pr-open', waiting: waiting(5) });
    expect(rowKey(a)).not.toBe(rowKey(b));

    const order = decisionOrder([a, b]);
    expect(decisionPosition(order, rowKey(a))).toEqual({ n: 1, of: 2 });
    expect(decisionPosition(order, rowKey(b))).toEqual({ n: 2, of: 2 });
    // Deciding one must not take the other with it.
    expect(nextDecision(order, new Set([rowKey(a)]))?.repo).toBe('arca-ops');
  });
});

describe('clearing three decisions in one sitting', () => {
  const rows = [
    row({ id: 'NEW', group: 'pr-open', waiting: waiting(1_000) }),
    row({ id: 'OLD', group: 'pr-open', waiting: waiting(9_000) }),
    row({ id: 'MID', group: 'pr-open', waiting: waiting(5_000) }),
    row({ id: 'QUIET', group: 'todo' }),
  ];

  it('takes the oldest first, because it has waited longest', () => {
    // The same ordering the desk's banner counts from, so "the oldest has waited 44 days" and the
    // first decision here are the same piece of work.
    expect(decisionOrder(rows).map((r) => r.id)).toEqual(['OLD', 'MID', 'NEW']);
  });

  it('is stable when two arrived in the same second', () => {
    // A queue that reshuffles under a founder deciding three in a row is a queue they stop trusting.
    const tie = [row({ id: 'B', group: 'pr-open', waiting: waiting(5) }), row({ id: 'A', group: 'pr-open', waiting: waiting(5) })];
    expect(decisionOrder(tie).map((r) => r.id)).toEqual(['A', 'B']);
  });

  it('says which decision this is of how many', () => {
    expect(decisionPosition(decisionOrder(rows), 'arca/MID')).toEqual({ n: 2, of: 3 });
    expect(decisionPosition(decisionOrder(rows), 'arca/QUIET')).toBeNull();
  });

  it('never offers back a ticket the founder just answered', () => {
    // Asked before the page has reloaded: the server does not yet know the decision was made, so
    // reading the rows alone would hand them the one they have just approved.
    const order = decisionOrder(rows);
    expect(nextDecision(order, new Set())?.id).toBe('OLD');
    expect(nextDecision(order, new Set(['arca/OLD']))?.id).toBe('MID');
    expect(nextDecision(order, new Set(['arca/OLD', 'arca/MID']))?.id).toBe('NEW');
    expect(nextDecision(order, new Set(['arca/OLD', 'arca/MID', 'arca/NEW']))).toBeNull();
  });
});

describe('what the studio can say was proven (FB-208)', () => {
  // The decision panel printed "Your team's own checks ran before this reached you" for every ticket
  // regardless — a sentence nobody had checked, on the screen where a founder decides whether to
  // accept work into their product.
  it('says the checks passed only when they passed', () => {
    expect(provenFact('success')).toContain('passed');
    expect(provenFact('failure')).not.toContain('and passed');
  });

  it('says a failure loudly, because it is the one a founder must not skim', () => {
    expect(provenFact('failure')).toContain('FAILED');
    expect(provenFact('failure')).toContain('Read what failed');
  });

  it('does not call a check that has not finished a pass', () => {
    expect(provenFact('pending')).toContain('still running');
    expect(provenFact('pending')).not.toContain('passed');
  });

  it('tells the two silences apart', () => {
    // "We could not look" and "there was nothing to look at" are different answers, and a founder
    // deciding on something irreversible is exactly the reader who must not be told otherwise.
    expect(provenFact('unavailable')).toContain('could not read');
    expect(provenFact('unknown')).toContain('No checks are recorded');
    expect(provenFact(null)).toContain('No checks are recorded');
    expect(provenFact(undefined)).toContain('No checks are recorded');
  });

  it('never claims proof it does not have', () => {
    for (const s of ['failure', 'pending', 'unavailable', 'unknown', null, undefined] as const) {
      expect(provenFact(s), String(s)).not.toMatch(/checks ran on this and passed/);
    }
  });
});

/**
 * FB-213 — a surface's link goes to that surface.
 */
describe('which surface the founder asked for', () => {
  const depts = [{ id: 'build', repo: 'arca' }, { id: 'sell', repo: 'arca-marketing' }];
  const repos = ['arca', 'arca-marketing', 'arca-ops'];

  it('resolves a department id, which is what belongs in a URL', () => {
    expect(resolveSurface('sell', depts, repos)).toBe('arca-marketing');
  });

  it('resolves a bare repository, for a queue with no department', () => {
    // "Other queues" on the desk are lanes the manifest does not claim. They have no founder-facing
    // name, so their link can only carry the repository — one parameter, both kinds.
    expect(resolveSurface('arca-ops', depts, repos)).toBe('arca-ops');
  });

  it('is not case-sensitive, because a URL gets typed and pasted', () => {
    expect(resolveSurface('SELL', depts, repos)).toBe('arca-marketing');
  });

  it('returns null for a surface it does not know, rather than filtering to nothing', () => {
    // An empty screen would read as "this surface has no work" — a claim about the venture made
    // from a typo in a URL.
    expect(resolveSurface('markteing', depts, repos)).toBeNull();
    expect(resolveSurface('', depts, repos)).toBeNull();
    expect(resolveSurface(undefined, depts, repos)).toBeNull();
  });

  it('prefers the department id when a repo happens to share the name', () => {
    expect(resolveSurface('build', [{ id: 'build', repo: 'arca' }], ['build'])).toBe('arca');
  });
});

describe('the rows of one surface', () => {
  const row = (repo: string, id: string): TicketRow => ({
    id, title: id, repo, group: 'todo', item: null, waiting: null, surface: null, progress: null,
  });

  it('keeps only that surface', () => {
    const rows = [row('arca', 'A-1'), row('arca-marketing', 'M-1'), row('arca', 'A-2')];
    expect(onSurface(rows, 'arca').map((r) => r.id)).toEqual(['A-1', 'A-2']);
  });

  it('keeps everything when no surface was asked for', () => {
    const rows = [row('arca', 'A-1'), row('arca-marketing', 'M-1')];
    expect(onSurface(rows, null)).toHaveLength(2);
  });

  it('does not mutate the caller’s array', () => {
    const rows = [row('arca', 'A-1')];
    onSurface(rows, 'arca-marketing');
    expect(rows).toHaveLength(1);
  });
});

describe('the status word on each row (FB-296)', () => {
  const working = { state: 'working' as const, text: 'Your team picked this up 5 minutes ago.', tone: 'working' as const };
  const card = (standing: string, waits = false) => ({ waits, standing, words: standing, sentence: '', ageMs: 0 }) as unknown as TicketRow['card'];
  const stoppedItem = { ticket: { id: 'S', title: 'S' }, warnings: [], stopped: true } as unknown as TicketRow['item'];

  it('says “Waiting for you” for anything waiting on the founder', () => {
    expect(ROW_STATUS_LABEL[rowStatus(row({ group: 'pr-open', waiting: waiting(1) }))]).toBe('Waiting for you');
  });

  it('says “Not started” for a ticket file saying “In progress” with nothing behind it', () => {
    expect(ROW_STATUS_LABEL[rowStatus(row({ group: 'in-progress' }))]).toBe('Not started');
  });

  it('says “Being built” only from a run that is going, or a factory card that is moving', () => {
    expect(rowStatus(row({ group: 'in-progress', progress: working }))).toBe('building');
    expect(rowStatus({ ...row({ group: 'todo' }), card: card('sent-back') })).toBe('building');
    expect(rowStatus({ ...row({ group: 'todo' }), card: card('approved') })).toBe('building');
  });

  it('tells “Done” and “Stopped” apart, though both are settled', () => {
    expect(ROW_STATUS_LABEL[rowStatus(row({ group: 'done' }))]).toBe('Done');
    const s = { ...row({ id: 'S', group: 'done' }), item: stoppedItem };
    expect(ROW_STATUS_LABEL[rowStatus(s)]).toBe('Stopped');
    expect(isSettled(s)).toBe(true);
  });

  it('says a signed-off factory card waits for John, and a stuck one is stuck', () => {
    expect(ROW_STATUS_LABEL[rowStatus({ ...row(), card: card('signed-off') })]).toBe('Waiting for John');
    expect(ROW_STATUS_LABEL[rowStatus({ ...row(), card: card('stuck') })]).toBe('Stuck');
  });
});
