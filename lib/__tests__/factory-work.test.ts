import { describe, expect, it } from 'vitest';
import {
  FACTORY_VENTURE, cardEvents, cardGroup, cardHref, cardRow, cardRows, cardsWaiting, isSameWork, metaLine,
  namer, standingOf, stuckNames, waitsOn, withoutCarded, type LoadedCard, type Viewer,
} from '../factory-work';
import { composeBrief } from '../brief';
import { buildFeed } from '../activity-feed';
import { needsYouCount } from '../needs-you';
import { countTickets, filterTickets, type TicketRow } from '../tickets-view';
import type { StoredPress } from '../presses';
import { storedCard } from './review-fixtures';

/**
 * FB-277: the factory's cards in the lists a founder already has. What each card says, to whom,
 * and that one piece of work is one row wherever GitHub and the factory both know about it.
 */

const JOHN = 'john.gallagher@wealthcx.com';
const FOUNDER = 'arca.founder@bruntsfield.capital';
const ARCA = { email: FOUNDER, name: 'Sam' };
const founder: Viewer = { isJohn: false, name: namer(FOUNDER, [JOHN], ARCA) };
const john: Viewer = { isJohn: true, name: namer(JOHN, [JOHN], ARCA) };

/** Just after the last of the presses below: none of them has lapsed. */
const READ_AT = Date.parse('2026-07-21T10:09:30.000Z');
const loaded = (repo: string, number: number, presses: StoredPress[] = [], ventureId = 'arca', readAt = READ_AT): LoadedCard => ({
  ventureId, card: storedCard(repo, number), presses, readAt,
});

let seq = 0;
function press(action: StoredPress['action'], by: string, patch: Partial<StoredPress> = {}): StoredPress {
  seq += 1;
  return {
    id: `p${seq}`, ventureId: 'arca', repo: 'arca', number: 21, action, by, byJohn: by === JOHN, source: 'studio',
    note: '', seenHeadSha: 'sha-arca-21', pressedAt: `2026-07-21T10:0${seq % 10}:00.000Z`, collectedAt: null, answer: null, ...patch,
  };
}

/** Everything a founder's browser would be sent, as one string, to look for John's words in. */
const sent = (x: unknown) => JSON.stringify(x);
const JOHNS_WORDS = [/\$\s?\d/, /what to do next/i, /tell the lane/i, /archon/i];

describe('where a card stands', () => {
  it("is the box's state, when the box says anything but finished", () => {
    expect(standingOf(loaded('arca', 22)).standing).toBe('stuck');
    expect(standingOf({ ...loaded('cowgate', 40), ventureId: FACTORY_VENTURE }).standing).toBe('done');
  });

  it('moves on with the presses on a finished card, as the Review screen reads them', () => {
    expect(standingOf(loaded('arca', 21)).standing).toBe('finished');
    expect(standingOf(loaded('arca', 21, [press('accept', FOUNDER)])).standing).toBe('signed-off');
    expect(standingOf(loaded('arca', 21, [press('send-back', FOUNDER)])).standing).toBe('sent-back');
    expect(standingOf(loaded('arca', 21, [press('approve', JOHN)])).standing).toBe('approved');
    expect(standingOf(loaded('arca', 21, [press('stop', FOUNDER)])).standing).toBe('stopped');
    expect(standingOf(loaded('arca', 21, [press('reject', JOHN, { source: 'telegram' })])).standing).toBe('rejected');
  });

  it('is done once John approved and the box answered done; nothing-done when the box said too late', () => {
    const done = press('approve', JOHN, { answer: { outcome: 'done', message: 'Made part of ARCA.', at: '2026-07-21T11:00:00.000Z' } });
    expect(standingOf(loaded('arca', 21, [done])).standing).toBe('done');
    const late = press('approve', JOHN, { answer: { outcome: 'out-of-date', message: 'Nothing was done.', at: '2026-07-21T11:00:00.000Z' } });
    expect(standingOf(loaded('arca', 21, [late])).standing).toBe('nothing-done');
  });
});

describe('what waits on whom', () => {
  it('finished, stuck and sent-back wait on anyone looking at the venture', () => {
    for (const s of ['finished', 'stuck', 'sent-back'] as const) {
      expect(waitsOn(s, false)).toBe(true);
      expect(waitsOn(s, true)).toBe(true);
    }
  });

  it("a founder's sign-off, or a card marked for John, waits on John and not on the founder", () => {
    for (const s of ['signed-off', 'needs-you'] as const) {
      expect(waitsOn(s, false)).toBe(false);
      expect(waitsOn(s, true)).toBe(true);
    }
  });

  it('a finished card John approved and the box answered done no longer waits on anyone', () => {
    const done = press('approve', JOHN, { answer: { outcome: 'done', message: 'Made part of ARCA.', at: '2026-07-21T11:00:00.000Z' } });
    expect(cardRow(loaded('arca', 21, [done]), founder, 'ARCA')).toMatchObject({ standing: 'done', waits: false, words: 'part of ARCA' });
    expect(cardRow(loaded('arca', 21, [done]), john, 'ARCA').waits).toBe(false);
  });
});

describe('a founder reads plain parts only; John reads his too', () => {
  it("a founder's row and lines carry no dollar figure, no next step, no \"Tell the lane\" and no Archon", () => {
    const cards = [loaded('arca', 20), loaded('arca', 21), loaded('arca', 22)];
    const rows = cardRows(cards, founder, () => 'ARCA');
    const lines = cards.flatMap((c) => cardEvents(c, founder, 'ARCA'));
    for (const re of JOHNS_WORDS) {
      expect(sent(rows)).not.toMatch(re);
      expect(sent(lines)).not.toMatch(re);
    }
    expect(rows.every((r) => r.john === null)).toBe(true);
    expect(lines.every((l) => l.cost === null)).toBe(true);
  });

  it('John reads the cost and the next step, in the words the card came with', () => {
    const row = cardRow(loaded('arca', 22), john, 'ARCA');
    expect(row.john).toEqual({ cost: '$6.80, of a $15 budget', nextStep: 'What to do next: Tell the lane which photo service to use, or split it.' });
    expect(metaLine(row, 'Build — Product')).toBe('Build — Product · stuck, needs a person · $6.80, of a $15 budget');
    expect(cardEvents(loaded('arca', 22), john, 'ARCA')[0].cost).toBe('$6.80, of a $15 budget');
  });

  it("a title that slipped one of John's words in is cut for a founder, and kept for John", () => {
    const lc = loaded('arca', 21);
    lc.card.plain = { ...lc.card.plain, title: 'Prices in pounds. It cost $2.10 in Archon.' };
    expect(cardRow(lc, founder, 'ARCA').title).toBe('Prices in pounds.');
    expect(cardRow(lc, john, 'ARCA').title).toContain('$2.10');
  });

  it("the box's answer reaches a founder through the same lock", () => {
    const answered = press('approve', JOHN, { answer: { outcome: 'done', message: 'Made part of ARCA. Archon run 7f3a cost $2.10.', at: '2026-07-21T11:00:00.000Z' } });
    const lines = cardEvents(loaded('arca', 21, [answered]), founder, 'ARCA').map((l) => l.text);
    expect(lines).toContain('Prices in pounds for every collector: Made part of ARCA.');
    expect(sent(lines)).not.toMatch(/archon|\$/i);
  });
});

describe('what happened, per card', () => {
  it('a finished card, then each press with who made it, then what the box said', () => {
    const accept = press('accept', FOUNDER, { pressedAt: '2026-07-21T10:00:00.000Z' });
    const approve = press('approve', JOHN, { pressedAt: '2026-07-21T10:30:00.000Z', answer: { outcome: 'done', message: 'Made part of ARCA.', at: '2026-07-21T11:00:00.000Z' } });
    expect(cardEvents(loaded('arca', 21, [accept, approve]), founder, 'ARCA').map((l) => l.text)).toEqual([
      'Your team finished Prices in pounds for every collector.',
      'You signed off Prices in pounds for every collector. It waits for John.',
      'John approved Prices in pounds for every collector.',
      'Prices in pounds for every collector: Made part of ARCA.',
    ]);
    expect(cardEvents(loaded('arca', 21, [accept]), john, 'ARCA')[1].text).toBe('Sam signed off Prices in pounds for every collector. It waits for you.');
  });

  it('a waiting finished card says it waits; a tap on Telegram is one line, not two', () => {
    expect(cardEvents(loaded('arca', 20), founder, 'ARCA')[0].text).toBe('Your team finished The auctions view. It waits for your OK.');
    const tap = press('reject', JOHN, { source: 'telegram', answer: { outcome: 'done', message: 'Rejected on Telegram.', at: '2026-07-21T10:01:00.000Z' } });
    const lines = cardEvents(loaded('arca', 21, [tap]), founder, 'ARCA');
    expect(lines.map((l) => l.text)).toEqual([
      'Your team finished Prices in pounds for every collector.',
      'John on Telegram turned down Prices in pounds for every collector.',
    ]);
  });

  it('a press the factory let lapse says nothing was done, and the card waits again (FB-278)', () => {
    const approve = press('approve', JOHN, { pressedAt: '2026-07-21T10:00:00.000Z' });
    const card = loaded('arca', 21, [approve], 'arca', Date.parse('2026-07-21T10:10:00.000Z'));
    expect(cardEvents(card, founder, 'ARCA').map((l) => l.text)).toEqual([
      'Your team finished Prices in pounds for every collector. It waits for your OK.',
      'John approved Prices in pounds for every collector.',
      'Prices in pounds for every collector: The factory did not pick up the last decision within 10 minutes. Nothing was done.',
    ]);
    expect(cardRow(card, founder, 'ARCA')).toMatchObject({ standing: 'finished', waits: true, at: '2026-07-21T10:10:00.000Z' });
  });

  it('go into the feed as rows of their own, named by ticket and surface, newest first', () => {
    const cards = cardEvents(loaded('arca', 22), founder, 'ARCA');
    const { items } = buildFeed({ activity: [], runs: [], approvals: [], cards, surfaces: { arca: 'Build — Product' }, ventureName: 'ARCA' });
    expect(items).toEqual([expect.objectContaining({ source: 'card', meta: 'ARCA-074 · Build — Product', text: 'Your team got stuck on Graded card photos on every listing. It needs a person.' })]);
  });
});

describe("the factory's lines have their own room in the feed", () => {
  const runAt = (i: number) => ({ kind: 'commit' as const, repo: 'arca', title: `change ${i}`, url: `https://x/${i}`, at: `2026-07-0${1 + (i % 9)}T00:00:00Z` });

  it('never push the record off the page, and are capped on their own', () => {
    const activity = Array.from({ length: 12 }, (_, i) => runAt(i));
    const cards = [20, 21, 22].flatMap((n) => cardEvents(loaded('arca', n, [press('accept', FOUNDER, { number: n })]), founder, 'ARCA'));
    const { items, truncated, cardsTruncated } = buildFeed({ activity, runs: [], approvals: [], cards, limit: 12, cardLimit: 4 });
    expect(items.filter((i) => i.source === 'repo')).toHaveLength(12);
    expect(items.filter((i) => i.source === 'card')).toHaveLength(4);
    expect(truncated).toBe(false);
    expect(cardsTruncated).toBe(true);
  });
});

describe('one piece of work is one row', () => {
  // GitHub reads arca#21 as an open pull request, and the factory has a card for arca#21: both are
  // the same work. A second pull request on ARCA-072's ticket is the same work too.
  const prs = [
    { repo: 'arca', number: 21, linkedTicketId: 'ARCA-072', title: 'GitHub says arca#21' },
    { repo: 'arca', number: 30, linkedTicketId: 'arca-072', title: 'A retry on the same ticket' },
    { repo: 'arca', number: 10, linkedTicketId: 'ARCA-1', title: 'Work with no card' },
    { repo: 'arca-marketing', number: 21, linkedTicketId: 'ARCA-072', title: 'Same number and id, another repository' },
  ];

  it("keeps the card's row and drops the pull requests it stands for", () => {
    const cards = [cardRow(loaded('arca', 21), founder, 'ARCA')];
    expect(withoutCarded(prs, cards).map((p) => p.title)).toEqual(['Work with no card', 'Same number and id, another repository']);
    expect(isSameWork(prs[0], cards[0])).toBe(true);
    expect(isSameWork(prs[3], cards[0])).toBe(false);
  });

  it('drops them even when the card no longer waits, so done work never comes back as a pull request', () => {
    const done = press('approve', JOHN, { answer: { outcome: 'done', message: 'Made part of ARCA.', at: '2026-07-21T11:00:00.000Z' } });
    const cards = [cardRow(loaded('arca', 21, [done]), founder, 'ARCA')];
    expect(withoutCarded(prs, cards).map((p) => p.number)).toEqual([10, 21]);
    expect(cardsWaiting(cards)).toBe(0);
  });

  it('the count is the open work no card stands for, plus the cards waiting, plus the sends', () => {
    const cards = cardRows([loaded('arca', 20), loaded('arca', 21), loaded('arca', 22)], founder, () => 'ARCA');
    const open = withoutCarded(prs, cards);
    expect(needsYouCount(open.length + cardsWaiting(cards), [])).toBe(2 + 3);
    // John's count is the founder's plus what waits on him alone.
    const signed = cardRows([loaded('arca', 21, [press('accept', FOUNDER)])], john, () => 'ARCA');
    expect(cardsWaiting(signed)).toBe(1);
    expect(cardsWaiting(cardRows([loaded('arca', 21, [press('accept', FOUNDER)])], founder, () => 'ARCA'))).toBe(0);
  });
});

describe('the Tickets screen', () => {
  const rowOf = (lc: LoadedCard, viewer: Viewer): TicketRow => {
    const c = cardRow(lc, viewer, 'ARCA');
    return {
      id: c.ref, title: c.title, repo: c.repo, group: cardGroup(c), item: null, progress: null, waiting: null, surface: 'Build',
      card: { waits: c.waits, standing: c.standing, words: c.words, sentence: '', ageMs: 0, href: c.href, cost: c.john?.cost ?? null, nextStep: c.john?.nextStep ?? null, quiet: null },
    };
  };

  it('lists a waiting card under "Needs you" and counts it once', () => {
    const rows = [rowOf(loaded('arca', 20), founder), rowOf(loaded('arca', 22), founder)];
    expect(filterTickets(rows, 'needs')).toHaveLength(2);
    expect(countTickets(rows).needs).toBe(2);
  });

  it('a card that no longer waits is settled or underway, never "Needs you"', () => {
    const stopped = rowOf(loaded('arca', 21, [press('stop', FOUNDER)]), founder);
    const approved = rowOf(loaded('arca', 21, [press('approve', JOHN)]), founder);
    expect(filterTickets([stopped], 'settled')).toHaveLength(1);
    expect(filterTickets([approved], 'underway')).toHaveLength(1);
    expect(countTickets([stopped, approved]).needs).toBe(0);
  });

  it("a finished card leads to its Review screen; any other to its row; the factory's to no Review screen", () => {
    expect(cardHref(cardRow(loaded('arca', 20), founder, 'ARCA'))).toBe('/venture/arca/review/arca/20');
    expect(cardHref(cardRow(loaded('arca', 22), founder, 'ARCA'))).toBe('/venture/arca/tickets?filter=needs&t=arca%2FARCA-074');
    const factory = { ...loaded('cowgate', 40), ventureId: FACTORY_VENTURE };
    factory.card = { ...factory.card, state: 'finished' };
    expect(cardRow(factory, john, 'The factory').href).toBeNull();
  });
});

describe("the desk's stuck line", () => {
  it('names a stuck card beside the stuck tickets, once', () => {
    const cards = cardRows([loaded('arca', 22)], founder, () => 'ARCA');
    const brief = composeBrief({
      // The stuck card waits on the founder too, so the first line (the headline) is what waits.
      ventureName: 'ARCA', openWork: [{ ticketId: 'ARCA-074', ageMs: 60_000 }], awaitingApproval: 0, runs: [], overBudget: [], degraded: false,
      engine: { state: 'running', text: '', ageMinutes: 1 }, stuckCards: [...stuckNames(cards), ...stuckNames(cards)],
    });
    const stuck = brief.lines.filter((l) => l.tone === 'blocked');
    expect(stuck.map((l) => l.text)).toEqual(['1 ticket is stuck and needs a human: Graded card photos on every listing.']);
  });
});
