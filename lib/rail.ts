import { cache } from 'react';
import type { VentureSummary } from './ventures';
import { loadVentureAttention } from './attention';
import { departmentBudgets, type BudgetDisclosure } from './budgets';
import { loadEnvelopes } from './budgets-load';
import { toSpends, type ActiveGraphApproval } from './approvals';
import { engineStateAt, type EngineState } from './runreports';
import { ventureApprovals, ventureLiveness } from './venture-reads';
import { timed } from './timing';
import { needsYouCount } from './needs-you';
import { studioNow } from './when';
import { ventureCards } from './factory-work-load';
import { cardRows, cardsWaiting, withoutCarded } from './factory-work';
import { builtByFactory, factoryLine } from './factory-built';

/**
 * What the rail needs, loaded once per request (FB-124).
 *
 * ## Why this exists rather than the page passing its data down
 *
 * The rail is a layout (`app/venture/[id]/layout.tsx`) so every screen under a venture gets it without
 * re-declaring it. In the App Router a layout **cannot receive data from its page** — they render
 * independently — so the rail has to load its own.
 *
 * Which is the trap. Two independent loads of the same numbers is how the venture board came to take
 * forty seconds (FB-123): nothing was wrong with any single read, there were simply far more of them
 * than anyone had counted. A rail on every screen multiplies that by every screen.
 *
 * So this is wrapped in React's `cache()`, which dedupes **within one request**: the layout and the
 * page both call it and the second call is free. That is a different mechanism from the module-level
 * Maps in `attention.ts` and `health.ts`, which dedupe *across* requests on a TTL. Those help too, and
 * they do not help the case this exists for, which is one render asking twice.
 *
 * ## What it deliberately does not carry
 *
 * A link to the venture box's own chat. The first draft had one and `e2e/composer.spec.ts` caught it:
 * "nothing on the composer sends the founder to another product" — FB-065's whole point, and a rail
 * link would have put that hand-off on every screen.
 *
 * The office plate's live state. That is FB-139 (G6); until it exists the rail draws a placeholder
 * that says so in words. A rail polling a feed that does not exist would be the most expensive way to
 * render nothing.
 */
export interface RailData {
  /**
   * How much waits on this founder — the one number the badge shows (FB-149).
   *
   * Open pull requests AND external sends waiting on the founder, from `needsYouCount`. The same
   * number the desk's sentence and amber banner state, and the same number the badge's destination
   * — Tickets, filtered to "Needs you" — lists, because that screen now carries the sends as rows.
   *
   * It used to be open work only, because the badge's row led to a page that could not list a send,
   * and a badge saying 8 over a page saying 4 is the FB-099 mismatch. Now the destination can, so
   * the number widened with it, and they cannot disagree.
   */
  needsYou: number;
  /**
   * Finished work alone — the half of `needsYou` that is not a send. The ledger wants it. Since
   * FB-277 that is the open pull requests no factory card stands for, plus the cards waiting.
   */
  openWork: number;
  /**
   * Per-department budgets. `null` **inside** the array where a department declares no envelope;
   * the whole array `null` when the spend could not be read at all (FB-137).
   *
   * Those are three different sentences — "no limit set", "nothing spent", "we could not look" —
   * and the rail said the second for all three until this was split out.
   */
  budgets: (BudgetDisclosure | null)[] | null;
  engine: { state: EngineState; text: string; ageMinutes: number | null };
  /** True when any read above failed. The rail is quieter about what it could not load, not silent. */
  degraded: boolean;
}

/**
 * The rail's data for one venture, once per request.
 *
 * Every read degrades rather than throws. A rail that 500s takes every screen with it — and the
 * situation it would be reporting on, a venture whose reads are failing, is exactly when a founder
 * most needs the page to still render (CLAUDE.md #10).
 */
export const loadRailData = cache(async (venture: VentureSummary, nowMs: number = studioNow(), isJohn: boolean = false): Promise<RailData> =>
  timed('rail: everything', () => railData(venture, nowMs, isJohn), venture.id));

/**
 * `isJohn`: a card a founder has signed off waits on John, not on them (FB-277), so whose rail this
 * is changes the count by exactly those cards.
 */
async function railData(venture: VentureSummary, nowMs: number, isJohn: boolean): Promise<RailData> {
  let degraded = false;
  const factory = builtByFactory(venture.id);
  const fell = <T,>(fallback: T) => (): T => {
    degraded = true;
    return fallback;
  };

  // Timed individually (FB-151). The three run in parallel, so their sum is not the wall clock —
  // what these readings answer is WHICH of them the wall clock is waiting on, which is the question
  // two rounds of optimisation have now got wrong by reasoning instead of measuring.
  const [attention, approvals, runs, cards] = await Promise.all([
    timed('rail: open work', () => loadVentureAttention(venture), venture.id)
      .catch(fell<Awaited<ReturnType<typeof loadVentureAttention>> | null>(null)),
    // Shared with the page inside this layout (FB-157) — these were two full reads per request.
    timed('rail: your approvals', () => ventureApprovals(venture), venture.id)
      .catch(fell<ActiveGraphApproval[]>([])),
    // FB-164: the listing, not sixty files per repository. The rail wants one instant out of the run
    // history — whether the machine is alive — and reading the reports themselves to find it made
    // every screen under a venture wait about six seconds, including a handbook page whose own
    // content arrives in 279ms.
    // FB-295: never for a venture the factory builds. Its old machine has stopped, and reading it
    // only ever says so.
    factory
      ? Promise.resolve(null)
      : timed('rail: is your team alive', () => ventureLiveness(venture), venture.id)
        .catch(fell<Awaited<ReturnType<typeof ventureLiveness>> | null>(null)),
    // FB-277: the factory's cards. Shared with the page, once per request.
    timed('rail: the factory\'s cards', () => ventureCards(venture.id), venture.id),
  ]);
  if (cards.unread) degraded = true;
  // One row per piece of work: a pull request a card stands for is counted as the card.
  const rows = cardRows(cards.cards, { isJohn, name: (e) => e }, () => venture.name);
  const openWork = withoutCarded(attention?.approvals ?? [], rows).length + cardsWaiting(rows);

  // Envelopes are read from disk in this repo, not over the network — cheap, and synchronous.
  const { envelopes } = loadEnvelopes(venture.id);
  // Spend comes from the APPROVALS. When that read failed, `approvals` is `[]` — and `[]` means
  // "nothing has been spent", which is a claim (FB-137). The rail printed `£0/£4,800` for a venture
  // whose spending it had not been able to look at, on the most-seen surface in the product.
  //
  // So the budgets are withheld entirely rather than computed from an empty list. `railWords` already
  // renders `null` as "checking", which is the true answer.
  const spendUnread = degraded && approvals.length === 0;
  const { budgets } = departmentBudgets(
    venture.departments.map((d) => d.id),
    envelopes,
    toSpends(approvals),
    new Date(nowMs),
  );

  // Both lists (FB-139) — see the note on `engineState`. The rail and the desk must not disagree
  // about whether the machine is alive, so they read the same thing the same way.
  const engine = factory
    ? factoryLine(venture.name, rows, cards.quiet, nowMs)
    : engineStateAt(runs?.at ?? null, new Date(nowMs));
  // A listing the studio could not read is not a machine that has stopped.
  if (runs?.degraded) degraded = true;

  return {
    // A failed read is `degraded`, and the badge is then a floor, not a claim of zero.
    needsYou: needsYouCount(openWork, approvals),
    openWork,
    budgets: spendUnread ? null : budgets,
    engine: { state: engine.state, text: engine.text, ageMinutes: engine.ageMinutes },
    degraded,
  };
}

// --- what the rail says when it does not know yet (FB-151) -------------------------------------

/**
 * The rail's three facts, each either known or explicitly not.
 *
 * The rail's numbers stream, so there is now a moment on every screen where it is drawn and the
 * numbers are not in. That moment is exactly where an invented value would be born, and the rail is
 * the most-seen surface in the product — a zero here is believed everywhere (FB-124).
 *
 * So the "we do not know yet" state is a value with a type rather than a branch inside JSX. It can
 * be tested without a browser, and there is one place where "unknown" turns into words instead of
 * three places that could each decide differently.
 */
export interface RailWords {
  /** How much waits on the founder — `null` while it is still being counted. Never 0 for unknown. */
  needsYou: number | null;
  engine: { state: EngineState | 'checking'; text: string };
  /** Per-department budgets, or `null` for the whole list while it is still being read. */
  budgets: (BudgetDisclosure | null)[] | null;
}

export function railWords(data: RailData | null): RailWords {
  if (!data) {
    return {
      needsYou: null,
      // Not "quiet" and not "stalled": both are findings about the venture, and nothing has been
      // found yet.
      engine: { state: 'checking', text: 'Checking whether your team is running.' },
      budgets: null,
    };
  }
  return { needsYou: data.needsYou, engine: data.engine, budgets: data.budgets };
}
