import { describe, it, expect } from 'vitest';
import {
  canonicalEvent, eventPath, narrate, narrateFault, project, seqFromPath, proposedEventData, activeGraphGateMode,
  type ActiveGraphEvent, type EventType, type ActorKind,
} from '../activegraph';

const ev = (over: Partial<ActiveGraphEvent> & { type: EventType; seq: number }): ActiveGraphEvent => ({
  v: 1, venture: 'arca', repo: 'wealthcx01/arca-marketing', id: 'send-001',
  at: '2026-07-31T12:00:00Z', actor: { kind: 'agent', id: 'foundry-lane' },
  ...over,
});

const human = (id = 'john@bruntsfield.capital') => ({ kind: 'human' as ActorKind, id });

describe('replaying what happened', () => {
  it('tells the whole story in order', () => {
    const p = project([
      ev({ seq: 1, type: 'approval.proposed' }),
      ev({ seq: 2, type: 'approval.granted', actor: human() }),
      ev({ seq: 3, type: 'action.executing', actor: { kind: 'executor', id: 'foundry-executor' } }),
      ev({ seq: 4, type: 'action.executed', actor: { kind: 'executor', id: 'foundry-executor' } }),
    ]);
    expect(p.status).toBe('executed');
    expect(p.approver).toBe('john@bruntsfield.capital');
    expect(p.applied).toHaveLength(4);
    expect(p.faults).toHaveLength(0);
  });

  it('replays the same whatever order the events arrive in', () => {
    // Ordering comes from `seq`, never from a clock: the studio and the executor write from
    // different machines, and two disagreeing clocks must not produce two different histories.
    const events = [
      ev({ seq: 3, type: 'action.executing', at: '2020-01-01T00:00:00Z', actor: { kind: 'executor', id: 'x' } }),
      ev({ seq: 1, type: 'approval.proposed', at: '2030-01-01T00:00:00Z' }),
      ev({ seq: 2, type: 'approval.granted', at: '2019-01-01T00:00:00Z', actor: human() }),
    ];
    const a = project(events);
    const b = project([...events].reverse());
    expect(a.status).toBe('executing');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('what a lane cannot make this believe', () => {
  it('refuses a grant that no human issued', () => {
    // The failure FB-051 was withdrawn over. A lane wrote `approval.granted` and the projection
    // reported a grant, by a named person, with no fault raised. This rule lives here — in the
    // projection — as well as in the signature, so it holds even if a secret ever leaks.
    const p = project([
      ev({ seq: 1, type: 'approval.proposed' }),
      ev({ seq: 2, type: 'approval.granted', actor: { kind: 'agent', id: 'foundry-lane' } }),
    ]);
    expect(p.status).toBe('proposed');
    expect(p.approver).toBeNull();
    expect(p.faults[0].reason).toBe('an agent cannot grant — only a person can agree to this');
  });

  it('refuses a grant from the executor too, not just from a lane', () => {
    // The executor holds the signing secret, so it CAN produce a valid signature. It still cannot
    // agree to something on a founder's behalf.
    const p = project([
      ev({ seq: 1, type: 'approval.proposed' }),
      ev({ seq: 2, type: 'approval.granted', actor: { kind: 'executor', id: 'foundry-executor' } }),
    ]);
    expect(p.status).toBe('proposed');
    expect(p.approver).toBeNull();
  });

  it('will not let an action be executed without a grant in front of it', () => {
    const p = project([
      ev({ seq: 1, type: 'approval.proposed' }),
      ev({ seq: 2, type: 'action.executed', actor: { kind: 'executor', id: 'x' } }),
    ]);
    expect(p.status).toBe('proposed');
    expect(p.faults[0].reason).toBe('action.executed cannot follow proposed');
  });

  it('will not accept an approval that begins already granted', () => {
    // Skipping the proposal is how you would fabricate an approval nobody ever asked for.
    const p = project([ev({ seq: 1, type: 'approval.granted', actor: human() })]);
    expect(p.status).toBe('unknown');
    expect(p.faults).toHaveLength(1);
  });

  it('refuses a second event written over an existing position', () => {
    // Appending is the only legal move. Two events at one position means someone rewrote history.
    const p = project([
      ev({ seq: 1, type: 'approval.proposed' }),
      ev({ seq: 2, type: 'approval.granted', actor: human() }),
      ev({ seq: 2, type: 'approval.rejected', actor: human('someone-else@example.com') }),
    ]);
    expect(p.status).toBe('granted');
    expect(p.approver).toBe('john@bruntsfield.capital');
    expect(p.faults[0].reason).toContain('two events claim position 2');
  });

  it('cannot be un-rejected', () => {
    const p = project([
      ev({ seq: 1, type: 'approval.proposed' }),
      ev({ seq: 2, type: 'approval.rejected', actor: human() }),
      ev({ seq: 3, type: 'approval.granted', actor: human() }),
    ]);
    expect(p.status).toBe('rejected');
    expect(p.approver).toBeNull();
  });

  it('cannot be re-run after it is done', () => {
    const p = project([
      ev({ seq: 1, type: 'approval.proposed' }),
      ev({ seq: 2, type: 'approval.granted', actor: human() }),
      ev({ seq: 3, type: 'action.executed', actor: { kind: 'executor', id: 'x' } }),
      ev({ seq: 4, type: 'action.executing', actor: { kind: 'executor', id: 'x' } }),
    ]);
    expect(p.status).toBe('executed');
    expect(p.faults).toHaveLength(1);
  });

  it('never hides what it refused', () => {
    // A log that quietly discards what it does not like cannot be audited either (CLAUDE.md #10).
    const p = project([ev({ seq: 1, type: 'approval.granted', actor: { kind: 'agent', id: 'lane' } })]);
    expect(narrateFault(p.faults[0])).toContain('would not accept');
    expect(narrateFault(p.faults[0])).toContain('did not change anything');
  });
});

describe('signing the same bytes every time', () => {
  it('does not depend on the order keys were written in', () => {
    // If the canonical form followed key order, a re-serialised event would fail its own signature
    // and a real record would read as forged.
    const a = ev({ seq: 1, type: 'approval.proposed', data: { summary: 'send the invite', to: '40 people' } });
    const b = ev({ seq: 1, type: 'approval.proposed', data: { to: '40 people', summary: 'send the invite' } });
    expect(canonicalEvent(a)).toBe(canonicalEvent(b));
  });

  it('changes when anything that matters changes', () => {
    const base = ev({ seq: 1, type: 'approval.proposed' });
    const variants = [
      { ...base, seq: 2 },
      { ...base, venture: 'the-reset' },
      { ...base, repo: 'wealthcx01/arca' },
      { ...base, id: 'send-002' },
      { ...base, type: 'approval.granted' as EventType },
      { ...base, actor: human() },
      { ...base, data: { summary: 'something else' } },
    ];
    for (const v of variants) expect(canonicalEvent(v), JSON.stringify(v)).not.toBe(canonicalEvent(base));
  });
});

describe('where an event is filed', () => {
  it('keeps two ventures apart even when they use the same approval id', () => {
    const a = eventPath('arca', 'wealthcx01/arca-marketing', 'send-001', 1, 'approval.proposed');
    const b = eventPath('the-reset', 'wealthcx01/thereset-marketing', 'send-001', 1, 'approval.proposed');
    expect(a).not.toBe(b);
    expect(a).toContain('/arca/');
    expect(b).toContain('/the-reset/');
  });

  it('keeps two repos in one venture apart', () => {
    expect(eventPath('arca', 'wealthcx01/arca', 'x', 1, 'approval.proposed'))
      .not.toBe(eventPath('arca', 'wealthcx01/arca-ops', 'x', 1, 'approval.proposed'));
  });

  it('sorts in sequence order as plain text, past ten', () => {
    // Zero-padded, so a directory listing is already in order and event 10 does not sort before 2.
    const paths = [2, 10, 1].map((n) => eventPath('arca', 'r', 'id', n, 'approval.proposed'));
    expect([...paths].sort()).toEqual([paths[2], paths[0], paths[1]]);
  });

  it('reads its position back out', () => {
    expect(seqFromPath(eventPath('arca', 'r', 'id', 7, 'action.executed'))).toBe(7);
    expect(seqFromPath('activegraph/arca/r/id/notes.md')).toBeNull();
  });
});

describe('telling the founder what happened', () => {
  it('names the person who agreed', () => {
    expect(narrate(ev({ seq: 2, type: 'approval.granted', actor: human('matthew@bruntsfield.capital') })))
      .toBe('matthew@bruntsfield.capital approved it.');
  });

  it('names both people when a dual decision needed two (FB-271)', () => {
    expect(narrate(ev({
      seq: 2, type: 'approval.granted', actor: human('john@bruntsfield.capital'),
      data: { proposal_sha: 'sha', first_approver: 'matthew@bruntsfield.capital' },
    }))).toBe('matthew@bruntsfield.capital and john@bruntsfield.capital approved it.');
  });

  it('says who asked, without naming the machinery', () => {
    expect(narrate(ev({ seq: 1, type: 'approval.proposed', data: { summary: 'email 40 people' } })))
      .toBe('Your team asked for your OK: email 40 people.');
  });

  it('says plainly that nothing went out when it failed', () => {
    const line = narrate(ev({ seq: 4, type: 'action.failed', actor: { kind: 'executor', id: 'x' }, data: { reason: 'the mail provider refused it' } }));
    expect(line).toContain('the mail provider refused it');
    expect(line).toContain('nothing went out');
  });
});

describe('what a proposal tells ActiveGraph (FB-171)', () => {
  it('carries only plain text, because the signature must read the same in TypeScript and Python', () => {
    // An object or a boolean does not turn into the same text in both languages, and the canonical
    // form is text — so nothing but a string is let in.
    expect(proposedEventData('sha-1', { summary: 'Send it', ticket: 7, department: { id: 'sell' }, action_type: true }))
      .toEqual({ proposal_sha: 'sha-1', summary: 'Send it' });
    expect(proposedEventData('sha-1', { ticket: '   ' })).toEqual({ proposal_sha: 'sha-1' });
  });

  it('reads the gate setting the way the executor does', () => {
    expect(activeGraphGateMode(undefined)).toBe('off');
    expect(activeGraphGateMode('shadow')).toBe('shadow');
    expect(activeGraphGateMode('Enforce')).toBe('enforce');
    expect(activeGraphGateMode('enforced')).toBe('enforce');
  });
});
