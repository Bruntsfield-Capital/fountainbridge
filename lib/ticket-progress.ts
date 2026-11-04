/**
 * What is happening to one ticket, in one sentence (FB-098).
 *
 * John: *"the ticket get's worked (we should have some sort of simulator or loading bar for this),
 * and then a message or notification that the ticket has been worked, so the founder can review what
 * has been done."* Every piece of that loop already existed and none of it was visible AS a loop: a
 * founder filed a ticket and then met silence, and could only find out by reloading the right page
 * at the right moment and reading the activity strip like an engineer reading logs.
 *
 * ## Evidence, not animation
 *
 * The "simulator" is satisfied by truthful motion and nothing else. Every sentence below is derived
 * from something the studio actually read — a run's own timestamps, the team's real check-in, how
 * many attempts there were, whether a piece of work is open. There is deliberately no percentage and
 * no bar: a progress bar counting to nothing is the composer-said-it-filed bug (FB-062) in a costume,
 * and the whole reason this surface is trusted is that it has never yet claimed something it did not
 * know.
 *
 * The states, in the order they beat each other:
 *
 *   worked   — a piece of work is open for this ticket; the founder is the next thing that happens.
 *   parked   — it was tried and stopped. Says how many times, because "blocked" alone is not a fact
 *              anyone can act on (CLAUDE.md #10).
 *   working  — picked up, with when, and when the team last checked in.
 *   waiting  — nothing has happened yet, and that is said once per column rather than per card.
 */

import type { RunReport } from './runreports';
import { describeGap } from './runreports';
import type { TicketStatusGroup } from './tickets';
import type { Tone } from './status';

export interface TicketProgress {
  /** Which of the four states this is. Drives the test id, so the e2e can assert the state itself. */
  state: 'worked' | 'parked' | 'working';
  /** The whole sentence. One owner for these words, like `describeRun`. */
  text: string;
  tone: Tone;
  /** Where this leads, when it leads somewhere. */
  href?: string;
}

/** Minutes between two instants, or null when the timestamp cannot be read. */
function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

const gap = (minutes: number) => (minutes <= 1 ? 'just now' : `${describeGap(minutes)} ago`);

/**
 * The sentence for one ticket's card, or null when there is nothing true to say.
 *
 * Null is a real answer and the common one: a ticket nobody has touched has no news, and inventing a
 * line for it would put the same sentence on twenty cards — which is how a board teaches someone to
 * stop reading it (FB-063, FB-100's item 5).
 */
export function ticketProgress(input: {
  ticketId: string;
  ventureId: string;
  group: TicketStatusGroup;
  /** Every run the studio could read; this filters to the ones about this ticket. */
  runs: RunReport[];
  /** The team's own liveness, so "picked up" can be told apart from "picked up and then died". */
  engine: { state: string; ageMinutes: number | null };
  /** The open piece of work for this ticket, when there is one. */
  waiting: { repo: string; number: number } | null;
  now: number;
}): TicketProgress | null {
  const { ticketId, ventureId, group, engine, waiting, now } = input;
  const mine = input.runs.filter((r) => r.ticketsTouched.includes(ticketId));

  // 1. Worked. The founder is now the thing standing between this and their product.
  if (waiting) {
    return {
      state: 'worked',
      text: 'Worked — read it and decide.',
      tone: 'attention',
      href: `/venture/${ventureId}/work/${waiting.repo}/${waiting.number}`,
    };
  }

  // 2. Parked. Named with its attempt count: "blocked" on its own is not a fact anyone can act on,
  //    and three attempts at one ticket is the strongest signal on this board that a person is
  //    needed. A ticket that stopped and then got picked up again is NOT parked — the later run wins.
  const latest = mine[0] ?? null; // runs arrive newest-first
  const stopped = mine.filter((r) => r.outcome === 'blocked' || r.outcome === 'error');
  if (latest && (latest.outcome === 'blocked' || latest.outcome === 'error')) {
    const tries = stopped.length;
    return {
      state: 'parked',
      text:
        tries > 1
          ? `Tried ${tries} times and stopped — it needs a person.`
          : 'Tried and stopped — it needs a person.',
      tone: 'blocked',
    };
  }

  // 3. Working. Only from a run that is genuinely in flight, or from the column plus a run that
  //    started. "In progress" in the markdown with no run behind it is not evidence of anything,
  //    and since FB-296 it no longer counts as working: it said "Your team is on this" about ARCA
  //    tickets nobody had touched in months.
  if (latest?.outcome === null || (group === 'in-progress' && latest !== null)) {
    const started = minutesSince(latest?.startedAt ?? null, now);
    const since = started === null ? null : `Your team picked this up ${gap(started)}`;
    // The team's real check-in, which is the whole honest answer to "is anything happening?".
    const beat =
      engine.state === 'stalled'
        ? ' — but it has not checked in since, so something is wrong with this venture’s machine'
        : engine.ageMinutes === null
          ? ''
          : `; it last checked in ${gap(engine.ageMinutes)}`;
    if (!since) return { state: 'working', text: 'Your team is on this.', tone: 'working' };
    return {
      state: 'working',
      text: `${since}${beat}.`,
      tone: engine.state === 'stalled' ? 'blocked' : 'working',
    };
  }

  return null;
}
