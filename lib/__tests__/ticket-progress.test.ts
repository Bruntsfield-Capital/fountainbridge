import { describe, it, expect } from 'vitest';
import { ticketProgress } from '../ticket-progress';
import type { RunReport } from '../runreports';

const NOW = Date.parse('2026-08-04T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const run = (over: Partial<RunReport>): RunReport => ({
  laneId: 'arca-build', startedAt: ago(10), endedAt: ago(5), trigger: 'scheduled',
  outcome: 'progress', summaryMd: '', ticketsTouched: ['ARCA-44'], errorDetail: null, skillsUsed: [],
  prUrl: null, repo: 'arca', isHeartbeat: false, ...over,
});

const ask = (over: Parameters<typeof ticketProgress>[0] extends infer T ? Partial<T> : never = {}) =>
  ticketProgress({
    ticketId: 'ARCA-44', ventureId: 'arca', group: 'todo', runs: [],
    engine: { state: 'running', ageMinutes: 2 }, waiting: null, now: NOW, ...over,
  });

describe('what a ticket card can honestly say', () => {
  it('says nothing about a ticket nobody has touched', () => {
    // Null is the common answer and a real one. A line here would put the same sentence on twenty
    // cards, which is how a board teaches someone to stop reading it.
    expect(ask()).toBeNull();
  });

  it('tells the founder when they are the next thing that happens', () => {
    const p = ask({ group: 'pr-open', waiting: { repo: 'arca', number: 10 } });
    expect(p).toMatchObject({ state: 'worked', href: '/venture/arca/work/arca/10' });
    expect(p!.text).toBe('Worked — read it and decide.');
  });

  it('names how many attempts a parked ticket took', () => {
    // "Blocked" on its own is not a fact anyone can act on, and three attempts at one ticket is the
    // strongest signal on this board that a person is needed.
    const runs = [
      run({ outcome: 'error', startedAt: ago(5) }),
      run({ outcome: 'blocked', startedAt: ago(30) }),
      run({ outcome: 'blocked', startedAt: ago(60) }),
    ];
    const p = ask({ runs, group: 'in-progress' });
    expect(p).toMatchObject({ state: 'parked', tone: 'blocked' });
    expect(p!.text).toBe('Tried 3 times and stopped — it needs a person.');
  });

  it('does not call a ticket parked once it has been picked up again', () => {
    // The later run wins. A ticket that failed overnight and is being worked now is being worked.
    const runs = [run({ outcome: null, endedAt: null, startedAt: ago(3) }), run({ outcome: 'blocked', startedAt: ago(90) })];
    expect(ask({ runs, group: 'in-progress' })!.state).toBe('working');
  });

  it('says when it was picked up and when the team last checked in', () => {
    const runs = [run({ outcome: null, endedAt: null, startedAt: ago(12) })];
    const p = ask({ runs, group: 'in-progress', engine: { state: 'running', ageMinutes: 2 } });
    expect(p!.text).toBe('Your team picked this up 12 minutes ago; it last checked in 2 minutes ago.');
  });

  it('never shows a number it did not measure', () => {
    // The whole point: no percentage, no bar, nothing counting to a finish it cannot know.
    const runs = [run({ outcome: null, endedAt: null, startedAt: ago(12) })];
    const p = ask({ runs, group: 'in-progress' });
    expect(p!.text).not.toMatch(/%|\bof\b\s*\d|progress bar/);
  });

  it('says so when the team stopped checking in mid-ticket', () => {
    // "Picked up 3 hours ago" beside a silent machine reads as work in flight. It is not.
    const runs = [run({ outcome: null, endedAt: null, startedAt: ago(180) })];
    const p = ask({ runs, group: 'in-progress', engine: { state: 'stalled', ageMinutes: 175 } });
    expect(p!.tone).toBe('blocked');
    expect(p!.text).toContain('has not checked in since');
  });

  it('reads a run in flight as working even before the markdown catches up', () => {
    // The lane edits the Status line when it claims a ticket, and the studio's read of that file is
    // cached. The run itself is the earlier evidence.
    const runs = [run({ outcome: null, endedAt: null, startedAt: ago(1) })];
    expect(ask({ runs, group: 'todo' })!.state).toBe('working');
  });

  it('ignores runs about other tickets', () => {
    // FB-296: and with none of its own, "In progress" in the file is not evidence of work.
    expect(ask({ runs: [run({ ticketsTouched: ['ARCA-99'], outcome: 'blocked' })], group: 'in-progress' })).toBeNull();
  });

  it('a ticket file saying "In progress" with no run behind it is not working (FB-296)', () => {
    expect(ask({ runs: [], group: 'in-progress' })).toBeNull();
  });

  it('puts being worked above having once stopped', () => {
    const runs = [run({ outcome: 'blocked', startedAt: ago(30) })];
    expect(ask({ runs, group: 'pr-open', waiting: { repo: 'arca', number: 10 } })!.state).toBe('worked');
  });
});
