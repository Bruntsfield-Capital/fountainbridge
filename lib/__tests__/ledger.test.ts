import { describe, it, expect } from 'vitest';
import {
  rowTone, rowReason, toRow, totalSpend, ledgerSummary, waitingNow, provisioningPatterns,
  type LedgerRow,
} from '../ledger';

/**
 * The admin ledger's colouring (FB-136).
 *
 * The design states the whole screen in one sentence — "a row is amber when its founder is the
 * bottleneck, red when its engine is" — so these tests are that sentence, plus the two states it
 * does not name and the studio cannot do without: a row whose reads failed, and a row that is
 * genuinely quiet.
 */

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  ventureId: 'arca',
  name: 'ARCA',
  status: 'active',
  founderName: 'Founder',
  founderEmail: 'matthew@bruntsfield.capital',
  needsThem: 0,
  underway: 0,
  engine: { state: 'running' as const, text: 'Your team checked in 4 minutes ago.' },
  spend: null,
  degraded: false,
  ...over,
});

describe('what colour a venture is', () => {
  it('is amber when its founder is the bottleneck', () => {
    expect(rowTone(row({ needsThem: 3 }))).toBe('attention');
    expect(rowReason(row({ needsThem: 3 }))).toBe('3 things waiting on Founder.');
    expect(rowReason(row({ needsThem: 1 }))).toBe('1 thing waiting on Founder.');
  });

  it('is red when its team has stopped', () => {
    expect(rowTone(row({ engine: { state: 'stalled', text: 'Nothing since June.' } }))).toBe('blocked');
  });

  it('is AMBER, not red, when it is over its own budget (FB-211)', () => {
    // The colour was inherited rather than chosen. Red is for a fault nobody on the venture can
    // clear; spending past a limit is the single most decidable thing on the screen, and it belongs
    // in the same colour as the banner that says so.
    const over = row({ spend: { spentMinor: 600_000, limitMinor: 500_000, currency: 'GBP', over: true } });
    expect(rowTone(over)).toBe('attention');
    expect(rowReason(over)).toMatch(/passed the limit/);
  });

  it('says the money, not the queue, when a row is over budget AND holding work (FB-211)', () => {
    // Both are amber now, so the sentence is the only thing that distinguishes them — and the one
    // that costs money is the one to say out loud.
    const both = row({ needsThem: 4, spend: { spentMinor: 600_000, limitMinor: 500_000, currency: 'GBP', over: true } });
    expect(rowTone(both)).toBe('attention');
    expect(rowReason(both)).toMatch(/passed the limit/);
  });

  it('a stopped team still outranks an over-budget one', () => {
    // The precedence that must survive the colour change: a fault beats a decision, because a
    // founder deciding cannot restart a machine.
    const both = row({
      engine: { state: 'stalled', text: 'Nothing since June.' },
      spend: { spentMinor: 600_000, limitMinor: 500_000, currency: 'GBP', over: true },
    });
    expect(rowTone(both)).toBe('blocked');
    expect(rowReason(both)).toMatch(/needs fixing, not deciding/);
  });

  it('is red, not amber, when both are true at once', () => {
    // A stopped team with six decisions queued behind it is not a slow founder — it is a venture
    // that cannot proceed even if they decide. Red is the one that needs someone.
    const both = row({ needsThem: 6, engine: { state: 'stalled', text: 'Nothing since June.' } });
    expect(rowTone(both)).toBe('blocked');
    expect(rowReason(both)).toMatch(/needs fixing, not deciding/);
  });

  it('is never green on numbers it could not read', () => {
    // Painting an unreadable venture calm is the studio reporting health it never checked.
    expect(rowTone(row({ degraded: true }))).toBe('unknown');
    expect(rowTone(row({ degraded: true, needsThem: 0, underway: 0 }))).toBe('unknown');
    expect(rowReason(row({ degraded: true }))).toMatch(/could not be read/);
  });

  it('separates quiet from working', () => {
    expect(rowTone(row({ underway: 2 }))).toBe('ok');
    expect(rowTone(row())).toBe('idle');
    expect(rowReason(row())).toBe('Nothing waiting and nothing moving.');
  });

  it('names the venture’s founder, or says "its founder" rather than nobody', () => {
    expect(rowReason(row({ needsThem: 2, founderName: null }))).toBe('2 things waiting on its founder.');
  });
});

describe('what waits on a founder', () => {
  const base = {
    venture: { id: 'arca', name: 'ARCA', status: 'active', founderName: 'Founder', founderEmail: 'f@x' },
    underway: 1,
    engine: { state: 'running' as const, text: 'ok' },
    budgets: [],
    degraded: false,
  };

  it('is the same count the founder’s own desk shows', () => {
    // Open work PLUS external actions at the gate — `waitingOnFounder`, the desk's own arithmetic.
    // Two surfaces answering this differently is the FB-099 defect, across ventures.
    expect(toRow({ ...base, openWork: 4, awaitingApproval: 2 }).needsThem).toBe(6);
  });

  it('is null, never zero, when either half could not be read', () => {
    expect(toRow({ ...base, openWork: null, awaitingApproval: 2 }).needsThem).toBeNull();
    expect(toRow({ ...base, openWork: 4, awaitingApproval: null }).needsThem).toBeNull();
  });

  it('keeps the engine’s own words, and only a FAILED read is absent', () => {
    // "Nobody has run here yet" is a fact the studio owns and a founder needs. Rendering it as a
    // dash — which the first draft did, by collapsing it into the same `unknown` as an unread
    // engine — throws away the sentence and says nothing instead.
    const known = toRow({
      ...base, openWork: 0, awaitingApproval: 0,
      engine: { state: 'unknown', text: 'Your team is not working on this venture yet.' },
    });
    expect(known.engine?.text).toBe('Your team is not working on this venture yet.');

    const unread = toRow({ ...base, openWork: 0, awaitingApproval: 0, engine: null });
    expect(unread.engine).toBeNull();
    expect(rowTone(unread)).not.toBe('blocked'); // unread is not stopped
  });
});

describe('adding up a venture’s spend', () => {
  const b = (over: Partial<{ limitMinor: number; currency: string; reportedMinor: number; queuedMinor: number; overLimit: boolean }> = {}) =>
    ({ limitMinor: 500_000, currency: 'GBP', reportedMinor: 100_000, queuedMinor: 0, overLimit: false, ...over });

  it('totals the declared envelopes, spend and queued together', () => {
    expect(totalSpend([b(), b({ reportedMinor: 50_000, queuedMinor: 20_000 })])).toEqual({
      spentMinor: 170_000, limitMinor: 1_000_000, currency: 'GBP', over: false,
    });
  });

  it('refuses to add up two currencies', () => {
    // A GBP envelope plus a USD one, totalled and printed in GBP, is a number wrong in both.
    expect(totalSpend([b(), b({ currency: 'USD' })])).toBeNull();
  });

  it('is absent, not zero, when no department has an envelope', () => {
    expect(totalSpend([])).toBeNull();
    expect(totalSpend([null, null])).toBeNull();
    expect(totalSpend([b({ limitMinor: 0 })])).toBeNull();
  });

  it('is over when ANY department is over, not when the total is', () => {
    // A venture can be under overall and still have blown one surface's limit, which is the fact
    // the founder set the limit to learn.
    expect(totalSpend([b({ overLimit: true }), b()])?.over).toBe(true);
  });
});

describe('the sentence over the ledger', () => {
  it('counts the rows on the screen, by what they need', () => {
    expect(ledgerSummary([
      row({ engine: { state: 'stalled', text: 'x' } }),
      row({ needsThem: 2 }),
      row({ underway: 1 }),
    ])).toBe('3 ventures: 1 needs fixing, 1 waiting on its founder.');
  });

  it('says so plainly when nothing is stuck', () => {
    expect(ledgerSummary([row({ underway: 1 }), row()])).toBe('2 ventures, and nothing is stuck.');
  });

  it('counts what it could not read as its own kind of problem', () => {
    expect(ledgerSummary([row({ degraded: true })])).toBe('1 venture: 1 could not be read.');
  });

  it('does not claim a portfolio it does not have', () => {
    expect(ledgerSummary([])).toBe('No ventures yet.');
  });
});

describe('what is waiting right now', () => {
  it('reports the count and the middle age', () => {
    expect(waitingNow([1000, 5000, 3000])).toEqual({ count: 3, medianMs: 3000 });
  });

  it('is absent rather than zero when nothing waits', () => {
    expect(waitingNow([])).toBeNull();
  });

  it('drops ages that cannot be read rather than counting them as instant', () => {
    expect(waitingNow([NaN, -1, 4000])).toEqual({ count: 1, medianMs: 4000 });
  });
});

describe('which account to provision the next founder from', () => {
  const v = (id: string, over: Partial<{ founderEmail: string | null; vpsHost: string | null }> = {}) =>
    ({ id, name: id.toUpperCase(), founderEmail: 'f@x', vpsHost: 'box', ...over });

  it('names only ventures that are complete enough to copy', () => {
    const ventures = [v('arca'), v('nobox', { vpsHost: null }), v('nofounder', { founderEmail: null }), v('unwired')];
    const ready = [{ id: 'arca', ready: true }, { id: 'nobox', ready: true }, { id: 'nofounder', ready: true }, { id: 'unwired', ready: false }];
    expect(provisioningPatterns(ventures, ready)).toEqual(['ARCA']);
  });

  it('names none rather than the least bad one', () => {
    expect(provisioningPatterns([v('a', { vpsHost: null })], [{ id: 'a', ready: false }])).toEqual([]);
  });
});
