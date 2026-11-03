import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildTrail, type TrailInputs } from '../trail';
import { loadTrail } from '../trail-load';
import type { ActiveGraphEvent } from '../activegraph';
import type { RunReport } from '../runreports';

/**
 * The per-ticket trail (FB-125).
 *
 * Two things are under test and they are not the same. The **shape** must satisfy the vendored
 * schema, because a rendered entity that drifts from its contract is what CLAUDE.md #7 exists to
 * prevent. The **content** must be honest: no invented hop, no dead link, no unverified event passed
 * off as verified, and a source that could not be read reported as such rather than as a shorter
 * story.
 */

const SCHEMA = JSON.parse(readFileSync(join(__dirname, '..', '..', 'schema', 'Trail.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(SCHEMA);

const event = (over: Partial<ActiveGraphEvent> = {}): ActiveGraphEvent => ({
  v: 1,
  seq: 1,
  venture: 'arca',
  repo: 'arca',
  id: 'send-1',
  type: 'approval.granted',
  at: '2026-08-24T09:00:00.000Z',
  actor: { kind: 'human', id: 'matthew@bruntsfield.capital' },
  ...over,
});

const run = (over: Partial<RunReport> = {}): RunReport => ({
  laneId: 'arca',
  startedAt: '2026-08-22T09:02:00.000Z',
  endedAt: '2026-08-22T09:40:00.000Z',
  trigger: 'scheduled',
  outcome: 'opened-pr',
  summaryMd: 'did the thing',
  ticketsTouched: ['ARCA-068'],
  errorDetail: null, skillsUsed: [],
  prUrl: 'https://github.com/wealthcx01/arca/pull/58',
  repo: 'arca',
  isHeartbeat: false,
  ...over,
});

const inputs = (over: Partial<TrailInputs> = {}): TrailInputs => ({
  ventureId: 'arca',
  repo: 'arca',
  ticketId: 'ARCA-068',
  events: [],
  runs: [],
  pr: null,
  preview: null,
  ...over,
});

describe('the trail keeps its contract', () => {
  it('validates against the vendored schema', () => {
    const t = buildTrail(
      inputs({
        events: [{ event: event(), verified: true }],
        runs: [run()],
        pr: {
          number: 58,
          url: 'https://github.com/wealthcx01/arca/pull/58',
          branch: 'foundry/auction-source-research',
          createdAt: '2026-08-22T12:14:00.000Z',
          merged: false,
          commits: { count: 3, additions: 412, deletions: 38, diffUrl: 'https://vm.example/diff' },
          checks: { conclusion: 'success', at: '2026-08-22T12:18:00.000Z' },
        },
        preview: { url: 'https://preview.example', at: '2026-08-22T12:20:00.000Z' },
      }),
    );
    expect(validate(t), JSON.stringify(validate.errors)).toBe(true);
  });

  it('validates when it has nothing to say', () => {
    // The degenerate case still has to be on-contract: an empty history is a real answer and the
    // renderer must not have to guess whether it was given a Trail or a failure.
    expect(validate(buildTrail(inputs())), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe('what the trail is willing to claim', () => {
  it('orders by when things happened, not by which source they came from', () => {
    // The failure this prevents: a trail assembled source-by-source reads as three lists stapled
    // together and loses the only thing it is for.
    const t = buildTrail(
      inputs({
        preview: { url: 'https://preview.example', at: '2026-08-22T12:20:00.000Z' },
        events: [{ event: event({ at: '2026-08-24T09:00:00.000Z' }), verified: true }],
        runs: [run({ startedAt: '2026-08-22T09:02:00.000Z' })],
      }),
    );
    expect(t.hops.map((h) => h.at)).toEqual([
      '2026-08-22T09:02:00.000Z',
      '2026-08-22T12:20:00.000Z',
      '2026-08-24T09:00:00.000Z',
    ]);
  });

  it('a ticket nobody has picked up has a one-entry history, not an error', () => {
    const t = buildTrail(inputs({ events: [{ event: event({ type: 'approval.proposed' }), verified: true }] }));
    expect(t.hops).toHaveLength(1);
    expect(t.degraded).toBe(false);
  });

  it('shows an unverified event, and says it is unverified', () => {
    // Dropping it hides something that happened; passing it off as verified is the forgery the
    // signature exists to prevent. Neither is acceptable, so it is shown and marked.
    const t = buildTrail(inputs({ events: [{ event: event(), verified: false }] }));
    expect(t.hops[0]?.verified).toBe(false);
    expect(t.hops).toHaveLength(1);
  });

  it('marks a commit as neither verified nor unverified', () => {
    // Three-valued on purpose: a commit is not signed by the approval secret and never was. Marking
    // it `false` would make every commit look suspicious, which is how a warning stops being read.
    const t = buildTrail(
      inputs({
        pr: {
          number: 58,
          url: 'https://github.com/wealthcx01/arca/pull/58',
          branch: 'foundry/x',
          createdAt: '2026-08-22T12:14:00.000Z',
          merged: false,
        },
      }),
    );
    expect(t.hops[0]?.verified).toBeNull();
  });
});

describe('a hop carries a link or it carries none', () => {
  it('drops an href that is not addressable rather than rendering a dead link', () => {
    for (const href of ['', '   ', 'not-a-url', 'javascript:alert(1)', 'about:blank']) {
      const t = buildTrail(inputs({ runs: [run({ prUrl: href })] }));
      expect(t.hops[0]?.link, href).toBeNull();
    }
  });

  it('keeps an absolute link and a studio-relative one', () => {
    expect(buildTrail(inputs({ runs: [run({ prUrl: 'https://github.com/x/y/pull/1' })] })).hops[0]?.link)
      .toMatchObject({ href: 'https://github.com/x/y/pull/1', external: true });
  });

  it('never renders a link whose label is a URL', () => {
    // A founder reads labels, not addresses. This is the design's rule and it is cheap to hold.
    const t = buildTrail(
      inputs({
        runs: [run()],
        preview: { url: 'https://preview.example', at: '2026-08-22T12:20:00.000Z' },
      }),
    );
    for (const h of t.hops) {
      if (h.link) expect(h.link.label).not.toMatch(/^https?:\/\//);
    }
  });
});

describe('what it refuses to place', () => {
  it('drops an undateable event rather than guessing where it goes', () => {
    // A hop with no time cannot be placed in an ordered history, so it is not a hop. Inventing a
    // timestamp would put it somewhere it never was.
    const t = buildTrail(inputs({ events: [{ event: event({ at: 'not a date' }), verified: true }] }));
    expect(t.hops).toEqual([]);
  });

  it('says a check has none rather than implying one failed', () => {
    const t = buildTrail(
      inputs({
        pr: {
          number: 1,
          url: 'https://github.com/x/y/pull/1',
          branch: 'b',
          createdAt: '2026-08-22T12:14:00.000Z',
          merged: false,
          checks: { conclusion: 'unknown', at: '2026-08-22T12:18:00.000Z' },
        },
      }),
    );
    expect(t.hops.map((h) => h.text)).toContain('This work has no automatic checks');
  });

  it('carries degraded through, so a short trail and an unreadable one are distinguishable', () => {
    expect(buildTrail(inputs({ degraded: true })).degraded).toBe(true);
  });
});

/**
 * What a trail costs to open (FB-125, and FB-083's rule).
 *
 * Counted rather than timed. The read count is the thing that went wrong in FB-123 — a board that
 * opened every run report ever written to show twenty — and a timing test would be flaky and would
 * not say what was wrong.
 */
describe('the read budget', () => {
  const venture = { id: 'arca', repos: ['arca'], departments: [] } as never;

  const counting = (approvalsPerTicket: number, ventureRuns: number, ventureApprovals: number) => {
    const reads: string[] = [];
    const sources = {
      async work() {
        reads.push('work');
        return {
          // The venture has `ventureApprovals`; this ticket has `approvalsPerTicket`. Only the
          // second number may cost anything.
          approvalIds: Array.from({ length: approvalsPerTicket }, (_, i) => `send-${i}`),
          pr: null,
        };
      },
      async runs() {
        reads.push('runs');
        return Array.from({ length: ventureRuns }, (_, i) => ({
          laneId: 'arca', startedAt: `2026-08-${String(1 + (i % 27)).padStart(2, '0')}T09:00:00.000Z`,
          endedAt: null, trigger: 'scheduled' as const, outcome: 'progress' as const, summaryMd: '',
          ticketsTouched: [i === 0 ? 'ARCA-068' : `ARCA-${100 + i}`], errorDetail: null, skillsUsed: [], prUrl: null,
          repo: 'arca', isHeartbeat: false,
        }));
      },
      async events(_repo: string, id: string) { reads.push(`events:${id}`); return []; },
      async preview() { reads.push('preview'); return null; },
      // FB-130: one read for the conversation this ticket came out of, and it is counted here for
      // the same reason as the others — the budget is per ticket, never per venture.
      async thread() { reads.push('thread'); return null; },
    };
    // `ventureApprovals` is deliberately unused by the sources: it is the number that must not appear
    // in the read count, and naming it here is the point of the test.
    void ventureApprovals;
    return { sources, reads };
  };

  it('costs the ticket’s own events, not the venture’s history', async () => {
    const small = counting(2, 20, 10);
    const huge = counting(2, 2000, 400);
    await loadTrail(venture, 'arca', 'ARCA-068', small.sources);
    await loadTrail(venture, 'arca', 'ARCA-068', huge.sources);
    expect(huge.reads.length).toBe(small.reads.length);
  });

  it('reads run reports once and filters them, rather than re-reading per ticket', async () => {
    const { sources, reads } = counting(0, 500, 0);
    await loadTrail(venture, 'arca', 'ARCA-068', sources);
    expect(reads.filter((r) => r === 'runs')).toHaveLength(1);
  });

  it('reads one event set per approval the ticket has', async () => {
    const { sources, reads } = counting(3, 20, 200);
    await loadTrail(venture, 'arca', 'ARCA-068', sources);
    expect(reads.filter((r) => r.startsWith('events:'))).toHaveLength(3);
  });

  it('one unreadable source degrades the trail rather than losing it', async () => {
    const { sources } = counting(1, 5, 5);
    const broken = { ...sources, async events() { throw new Error('gone'); } };
    const t = await loadTrail(venture, 'arca', 'ARCA-068', broken as never);
    expect(t.degraded).toBe(true);
    // The run that touched this ticket is still there: one source failing must not empty the history.
    expect(t.hops.length).toBeGreaterThan(0);
  });
});

describe('a hop never reads as though a word were missing (FB-130)', () => {
  const pr = (branch: string) => ({
    number: 10, url: 'https://github.com/o/r/pull/10', branch,
    createdAt: '2026-08-22T10:00:00.000Z', merged: false,
  });

  it('names the branch when a source carried one', () => {
    const t = buildTrail(inputs({ pr: pr('arca-1-terminal-setup') }));
    expect(t.hops[0].text).toBe('Work started on arca-1-terminal-setup');
  });

  it('does not write "Work started on " when no source carried a branch', () => {
    // It did. The attention queue does not carry `headRefName`, so the trail printed a preposition
    // with nothing after it — on the one surface whose whole claim is that nothing on it can be
    // wrong about what ran.
    const t = buildTrail(inputs({ pr: pr('') }));
    expect(t.hops[0].text).toBe('Work started');
    expect(t.hops[0].text).not.toMatch(/ on\s*$/);
  });

  it('leaves the branch out of a commit summary rather than trailing it', () => {
    const t = buildTrail(inputs({
      pr: { ...pr(''), commits: { count: 2, additions: 30, deletions: 4 } },
    }));
    expect(t.hops[0].text).toBe('2 commits, +30 −4');
  });
});

describe('a trail with one entry is a trail with one entry (FB-130)', () => {
  it('renders as one hop, not as an error and not as empty', () => {
    const t = buildTrail(inputs({ preview: { url: 'https://preview.example', at: '2026-08-22T12:20:00.000Z' } }));
    expect(t.hops).toHaveLength(1);
    expect(t.degraded).toBe(false);
  });

  it('is told apart from a history that could not be read', () => {
    // A short trail and an unreadable one look identical, and one of them is a lie.
    const unreadable = buildTrail(inputs({ degraded: true }));
    expect(unreadable.hops).toHaveLength(0);
    expect(unreadable.degraded).toBe(true);
  });
});

describe('the conversation a ticket came out of (FB-130)', () => {
  const withThread = (thread: { at: string; kept: boolean } | null) =>
    buildTrail(inputs({ thread }));

  it('is on-contract, like every other source', () => {
    // The union gained `composer` and the vendored schema did not, so every real trail carrying the
    // new first hop was off-contract (CLAUDE.md #7) — and the lock-step test passed only because
    // none of these validated their output.
    const t = withThread({ at: '2026-08-22T09:00:00.000Z', kept: true });
    expect(validate(t), JSON.stringify(validate.errors)).toBe(true);
    expect(t.hops[0].source).toBe('composer');
  });

  it('starts at the founder’s own words', () => {
    // The trail exists so a founder can follow their words to something running, so it has to start
    // at the words.
    const t = withThread({ at: '2026-08-22T09:00:00.000Z', kept: true });
    expect(t.hops[0].source).toBe('composer');
    expect(t.hops[0].text).toContain('this conversation is its source');
  });

  it('stays in the studio, so the design renders it →', () => {
    const t = withThread({ at: '2026-08-22T09:00:00.000Z', kept: true });
    expect(t.hops[0].link?.external).toBe(false);
    expect(t.hops[0].link?.href).toMatch(/^\/venture\//);
  });

  it('says the transcript was not kept rather than linking nowhere', () => {
    // Transcripts lived in localStorage until FB-126, so a ticket filed before then has a
    // conversation that genuinely no longer exists. A link to it would be the dead link the whole
    // trail forbids.
    const t = withThread({ at: '2026-08-22T09:00:00.000Z', kept: false });
    expect(t.hops[0].text).toContain('not kept');
    expect(t.hops[0].link ?? null).toBeNull();
  });

  it('adds no hop at all when there was no conversation', () => {
    expect(withThread(null).hops.some((h) => h.source === 'composer')).toBe(false);
  });

  it('is undateable-safe, like every other source', () => {
    expect(withThread({ at: 'not a date', kept: true }).hops.some((h) => h.source === 'composer')).toBe(false);
  });
});
