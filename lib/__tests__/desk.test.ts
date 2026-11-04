import { describe, it, expect } from 'vitest';
import {
  blockerLine, degradedGroups, degradedNextStep, deskQueue, deskSummary, surfaceOutcome, waitingOnFounder, type DeskFacts,
} from '../desk';

/**
 * The desk's sentences (FB-128).
 *
 * The load-bearing property is that one number reaches three surfaces — the summary, the banner and
 * the rail's badge. FB-099 is what happens when it does not: a badge saying 15 over columns saying 0.
 */

const facts = (over: Partial<DeskFacts> = {}): DeskFacts => ({
  openWork: 2,
  awaitingApproval: 1,
  movingTickets: 2,
  spentMinor: 22000,
  limitMinor: 70000,
  queuedMinor: 0,
  currency: 'GBP',
  period: 'monthly',
  degraded: false,
  ...over,
});

describe('the one number three surfaces read', () => {
  it('counts finished work AND external actions waiting', () => {
    // A badge that counted finished work and quietly left out a proposed send would tell a founder
    // they were clear while an email sat waiting for their word.
    expect(waitingOnFounder({ openWork: 2, awaitingApproval: 1 })).toBe(3);
  });

  it('is zero when nothing is waiting', () => {
    expect(waitingOnFounder({ openWork: 0, awaitingApproval: 0 })).toBe(0);
  });

  it('is the number the summary and the banner both use', () => {
    const f = facts();
    expect(deskSummary(f)).toContain('3 decisions wait on you');
    expect(blockerLine({ ...f, oldestMs: 3 * 86_400_000 })).toContain('3 items');
  });
});

describe('the summary sentence', () => {
  it('reads as the design writes it', () => {
    // `formatMoney` already drops a bare .00, which is how the design writes it too.
    expect(deskSummary(facts())).toBe(
      '3 decisions wait on you; your team is on 2 moving tickets, and £220 of £700 is spent this month.',
    );
  });

  it('says nothing waits rather than “0 decisions”', () => {
    const s = deskSummary(facts({ openWork: 0, awaitingApproval: 0 }));
    expect(s).toMatch(/^Nothing waits on you/);
    expect(s).not.toContain('0 decision');
  });

  it('drops the clauses that are not true rather than reporting zeroes', () => {
    // A founder on day one should read one short sentence, not three clauses of zeroes dressed as
    // a report.
    const s = deskSummary(facts({ openWork: 0, awaitingApproval: 0, movingTickets: 0, limitMinor: null, spentMinor: null, currency: null }));
    expect(s).toBe('Nothing waits on you.');
  });

  it('is singular when there is one of a thing', () => {
    const s = deskSummary(facts({ openWork: 1, awaitingApproval: 0, movingTickets: 1 }));
    expect(s).toContain('1 decision waits on you');
    expect(s).toContain('1 moving ticket');
  });

  it('says so when it was composed over a picture it could not fully read', () => {
    // The difference between "nothing to report" and "cannot tell". Never a calm summary over a
    // partial read.
    expect(deskSummary(facts({ degraded: true }))).toContain('could not be read');
  });

  it('says nothing about money when no limit is set', () => {
    expect(deskSummary(facts({ limitMinor: 0 }))).not.toContain('spent this month');
    expect(deskSummary(facts({ currency: null }))).not.toContain('spent this month');
  });

  it('names money awaiting the founder rather than leaving it out', () => {
    // The rail totals reported AND queued. A desk saying "£0 is spent" beside a rail reading
    // "£5,200/£4,800" is two numbers for one budget on one screen.
    expect(deskSummary(facts({ spentMinor: 0, queuedMinor: 520000 })))
      .toContain('£0 of £700 is spent this month, with £5,200 awaiting your OK');
  });

  it('says nothing about waiting money when none is', () => {
    expect(deskSummary(facts())).not.toContain('awaiting your OK');
  });

  it('names the window it is actually reporting on', () => {
    // "this month" over a quarterly envelope is a false statement about a founder's own burn, on
    // the lead sentence of the screen.
    expect(deskSummary(facts({ period: 'quarterly' }))).toContain('is spent this quarter');
    expect(deskSummary(facts({ period: 'yearly' }))).toContain('is spent this year');
    expect(deskSummary(facts({ period: 'all-time' }))).toContain('is spent in total');
  });

  it('says nothing about money when the departments do not agree on one', () => {
    // The caller passes nulls when currencies or periods differ, because adding two currencies
    // produces a number that is wrong in both — which lib/budgets.ts already refuses to do.
    expect(deskSummary(facts({ period: null }))).not.toContain('spent');
  });
});

describe('the blocker banner', () => {
  it('names the founder as the blocker, and how long the oldest has waited', () => {
    expect(blockerLine({ openWork: 3, awaitingApproval: 0, oldestMs: 3 * 86_400_000 }))
      .toBe('You are the blocker on 3 items; the oldest has waited 3 days.');
  });

  it('says what KIND of thing is waiting when there is more than one', () => {
    // A read and an external action want different things from a founder, and the difference is
    // what tells them which to open first. This sentence used to live in the brief's headline —
    // one amber line carrying it beats a second block restating the same number.
    expect(blockerLine({ openWork: 4, awaitingApproval: 4, oldestMs: 44 * 86_400_000 })).toBe(
      'You are the blocker on 8 items — 4 pieces of finished work to read and 4 actions that would '
      + 'go outside the company; the oldest piece of work has waited 44 days.',
    );
  });

  it('does not spell out a breakdown of one kind', () => {
    expect(blockerLine({ openWork: 3, awaitingApproval: 0, oldestMs: null })).not.toContain('—');
  });

  it('says which oldest, when the age cannot describe everything it counts', () => {
    // A proposed external action has no raise-time the studio can read — `committedAt` is the grant
    // timestamp and it has not been granted. Attributing a pull request's age to a set that
    // includes approvals would be quietly wrong, so the sentence names what the age is of.
    expect(blockerLine({ openWork: 2, awaitingApproval: 1, oldestMs: 86_400_000 }))
      .toContain('the oldest piece of work has waited 1 day');
    expect(blockerLine({ openWork: 2, awaitingApproval: 0, oldestMs: 86_400_000 }))
      .toContain('the oldest has waited 1 day');
  });

  it('does not appear when nothing is waiting', () => {
    expect(blockerLine({ openWork: 0, awaitingApproval: 0, oldestMs: null })).toBeNull();
  });

  it('reads in hours before it reads in days', () => {
    expect(blockerLine({ openWork: 1, awaitingApproval: 0, oldestMs: 5 * 3_600_000 }))
      .toContain('the oldest has waited 5 hours');
  });

  it('does not say “0 days” for something that just arrived', () => {
    expect(blockerLine({ openWork: 1, awaitingApproval: 0, oldestMs: 60_000 }))
      .toContain('arrived just now');
  });

  it('still names the count when it cannot tell the age', () => {
    expect(blockerLine({ openWork: 2, awaitingApproval: 0, oldestMs: null }))
      .toBe('You are the blocker on 2 items.');
  });
});

describe('the degraded strip', () => {
  it('says one thing once, however many repositories hit it', () => {
    const groups = degradedGroups([
      { where: 'arca', message: 'GitHub is rate limiting reads.' },
      { where: 'arca-site', message: 'rate-limited' },
      { where: 'arca-ops', message: 'GitHub is rate limiting reads.' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].where).toEqual(['arca', 'arca-site', 'arca-ops']);
  });

  it('keeps genuinely different causes apart', () => {
    const groups = degradedGroups([
      { where: 'arca', message: 'GitHub is rate limiting reads.' },
      { where: 'arca-ops', message: 'The studio is not allowed to read this.' },
    ]);
    expect(groups).toHaveLength(2);
  });

  it('passes through a message it has no better words for', () => {
    // Never swallowed and never re-worded into something vaguer than what actually happened.
    const groups = degradedGroups([{ where: null, message: 'The state ref could not be read.' }]);
    expect(groups[0].cause).toBe('The state ref could not be read.');
    expect(groups[0].where).toEqual([]);
  });

  it('is empty when nothing failed', () => {
    expect(degradedGroups([])).toEqual([]);
    expect(degradedGroups([{ where: 'arca', message: '   ' }])).toEqual([]);
  });

  it('says one fault once, when two reads report it in different words (FB-297)', () => {
    const groups = degradedGroups([
      { where: 'arca', message: 'The studio could not read arca just now.' },
      { where: 'arca-ops', message: 'The studio could not read arca-ops just now.' },
      { where: null, message: 'arca: The studio could not read arca just now.' },
      { where: null, message: 'arca-ops: The studio could not read arca-ops just now.' },
    ]);
    expect(groups).toEqual([{ cause: 'The studio could not read these just now.', where: ['arca', 'arca-ops'], clears: true }]);
  });

  it('says a busy GitHub clears on its own (FB-297)', () => {
    const groups = degradedGroups([{ where: 'arca', message: 'GitHub rate limit hit — try refresh shortly.' }]);
    expect(groups[0]).toEqual({
      cause: 'GitHub is limiting how much the studio can read just now. This fills in as reads succeed.',
      where: ['arca'],
      clears: true,
    });
    expect(degradedNextStep(groups)).toBe('Nothing for you to do; it clears on its own.');
  });

  it('says a repository GitHub calls "not found" may be one the studio isn’t allowed to see, and that it won’t clear (FB-297)', () => {
    // GitHub answers "not found" for a private repository the key can't see. On staging, ARCA's two
    // private repositories did exactly that while the public one read fine.
    const groups = degradedGroups([
      { where: 'arca', message: 'Not Found' },
      { where: 'arca-marketing', message: '404 Not Found' },
      { where: 'arca-ops', message: 'GitHub rate limit hit — try refresh shortly.' },
    ]);
    expect(groups.map((g) => [g.cause, g.where, g.clears])).toEqual([
      ['GitHub says this isn’t there, or the studio isn’t allowed to see it.', ['arca', 'arca-marketing'], false],
      ['GitHub is limiting how much the studio can read just now. This fills in as reads succeed.', ['arca-ops'], true],
    ]);
    expect(degradedNextStep(groups)).toBe('This won’t clear on its own: someone has to give the studio access to it.');
  });
});

describe('the company, by surface', () => {
  const surface = (over: Partial<Parameters<typeof surfaceOutcome>[0]> = {}) =>
    surfaceOutcome({ departmentId: 'build', ticketCount: 14, hasLaunch: false, provisioned: true, ...over });

  it('says what a surface with something running actually has', () => {
    expect(surface({ hasLaunch: true })).toBe('14 tickets · preview of the app running from the venture machine.');
  });

  it('does not promise a preview a venture has not declared', () => {
    expect(surface()).not.toContain('preview of the app running');
  });

  it('says a surface has reported nothing rather than “0 delivered”', () => {
    // Nothing having reported and nothing having happened are different facts, and only one of them
    // is true (decision-surface-outcomes.md).
    //
    // FB-142 changed WHICH sentence Sell says — it now reads the sends the studio has gated, so a
    // venture that has never sent anything is told that rather than being told nothing reports. The
    // rule this test exists for is unchanged and is the second assertion.
    const line = surface({ departmentId: 'sell', ticketCount: 2 });
    expect(line).toContain('Nothing has been sent yet');
    expect(line).not.toMatch(/\b0 (delivered|opened|replied)/);
  });

  it('a surface with no reporting of its own still says so', () => {
    // The original sentence, on a surface that genuinely has no source — which is every one except
    // Sell, and Build when it has a launch.
    expect(surface({ departmentId: 'growth', ticketCount: 2 })).toContain('Nothing reported yet');
  });

  it('says Scale is not connected, and counts what waits on it', () => {
    expect(surface({ departmentId: 'scale', ticketCount: 1 }))
      .toBe('Not connected · platform tbd. 1 ticket waiting on it.');
  });

  it('names Meta, and says it is not connected, once a venture declares it (FB-248)', () => {
    // John ruled Meta first, so "platform tbd" is no longer true for a venture that declares it. But
    // no ad account is linked, so "not connected" still is — both halves have to be said.
    const line = surface({ departmentId: 'scale', ticketCount: 1, connectors: ['meta-ads'] });
    expect(line).toBe('Meta ads · not connected yet. 1 ticket waiting on it.');
    expect(line).not.toContain('tbd');
    // Keyed on the declaration, not on the id: a surface named anything else that declares Meta
    // says the same, and Scale without the declaration keeps the open-question line.
    expect(surface({ departmentId: 'growth', ticketCount: 0, connectors: ['meta-ads'] })).toContain('Meta ads · not connected yet');
    expect(surface({ departmentId: 'scale', ticketCount: 1, connectors: ['postmark'] })).toContain('platform tbd');
  });

  it('stops saying Scale is not connected the moment a venture connects one', () => {
    // The line was hard-coded against the id. A venture that later declares somewhere to open would
    // have gone on being told, in the studio's voice, that it is not connected.
    expect(surface({ departmentId: 'scale', hasLaunch: true })).toContain('preview of the app running');
  });

  it('reads a surface that is not set up from the manifest, not from its name', () => {
    expect(surface({ departmentId: 'anything-at-all', provisioned: false, ticketCount: 3 }))
      .toBe('Not set up yet. 3 tickets waiting on it.');
  });

  it('never renders a zero as though it were a measurement', () => {
    for (const departmentId of ['build', 'sell', 'scale']) {
      expect(surface({ departmentId, ticketCount: 0 })).toContain('No tickets yet');
    }
  });
});

describe('deskQueue (FB-203, item 10)', () => {
  const send = (id: string) => ({ id, external: true });
  const work = (id: string) => ({ id, external: false });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it('shows everything when the queue is short', () => {
    expect(ids(deskQueue([send('a'), work('b')], 4))).toEqual(['a', 'b']);
  });

  it('never erases the founder’s finished work behind a run of sends', () => {
    // Production: ARCA had six sends ahead of every pull request, so a cap of four showed four sends
    // and no work at all — on the screen the amber banner sends a founder to, having just counted
    // that work.
    const queue = [send('s1'), send('s2'), send('s3'), send('s4'), send('s5'), send('s6'), work('w1'), work('w2')];
    expect(ids(deskQueue(queue, 4))).toEqual(['s1', 's2', 's3', 'w1']);
  });

  it('never erases a send behind a run of finished work', () => {
    // The same rule the other way round. Nothing leaves the company without one of these.
    const queue = [work('w1'), work('w2'), work('w3'), work('w4'), work('w5'), send('s1')];
    expect(ids(deskQueue(queue, 4))).toEqual(['w1', 'w2', 'w3', 's1']);
  });

  it('leaves a mixed head alone', () => {
    const queue = [send('s1'), work('w1'), send('s2'), work('w2'), work('w3')];
    expect(ids(deskQueue(queue, 4))).toEqual(['s1', 'w1', 's2', 'w2']);
  });

  it('does not invent a second kind that is not waiting', () => {
    const queue = [send('s1'), send('s2'), send('s3'), send('s4'), send('s5')];
    expect(ids(deskQueue(queue, 4))).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('shows nothing when there is no room, rather than one thing', () => {
    expect(deskQueue([send('a')], 0)).toEqual([]);
  });
});
