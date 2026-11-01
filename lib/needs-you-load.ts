import 'server-only';

/**
 * Everything waiting on one person, across every venture they can see (FB-149).
 *
 * ## Why this exists
 *
 * An admin's header "Needs you" leads to `/attention`, the cross-venture page. That page listed
 * finished work only, and the header counted finished work only. Each venture's desk counts finished
 * work AND the sends waiting on the founder. So an admin read 4 in the header and 10 on ARCA's desk,
 * for one question.
 *
 * This loader gives the cross-venture page and the header one answer, built from the same rule every
 * venture screen uses (`lib/needs-you.ts`): for each venture, its open pull requests plus the sends
 * `sendsWaitingOnFounder` picks out. Summed per venture with `needsYouCount`, so the cross-venture
 * number is the sum of the desks' numbers and cannot drift from them.
 *
 * Split from `lib/needs-you.ts` because that file is imported by components, and this one reads the
 * network.
 */

import { loadAccessibleAttention, type PrApproval } from './attention';
import type { ActiveGraphApproval } from './approvals';
import { authorizeVentures, canAccessVenture, parseAdminEmails } from './authz';
import { loadVentures, type VentureSummary } from './ventures';
import type { MatchableTicket } from './ticket-match';
import { ventureApprovals } from './venture-reads';
import { needsYouCount, sendRow, sendSurface, sendsWaitingOnFounder } from './needs-you';
import type { TicketRow } from './tickets-view';
import { factoryCardsForJohn, ventureCardRows, viewerOf } from './factory-work-load';
import { FACTORY_NAME, FACTORY_VENTURE, cardsWaiting, withoutCarded, type CardRow } from './factory-work';

/** A send waiting on a founder, with the venture it belongs to. */
export interface WaitingSend {
  ventureId: string;
  /** The Tickets-row shape, which already carries the send page's address and the state in words. */
  row: TicketRow & { send: NonNullable<TicketRow['send']> };
}

export interface AccessibleNeedsYou {
  /**
   * Open pull requests across the ventures, oldest first — what `/attention` always listed. Since
   * FB-277, only those no factory card stands for: where both exist, the card's row is shown.
   */
  work: PrApproval[];
  /**
   * The factory's cards waiting on this person, venture by venture, oldest first (FB-277). For John
   * this includes the factory's own (`_factory`), which no founder ever sees.
   */
  cards: CardRow[];
  /** Sends waiting on the founder, per venture, in the order each venture's store gave them. */
  sends: WaitingSend[];
  /** The one number: the sum of every venture's `needsYouCount`. */
  count: number;
  /** Each venture's own number — the one its desk and rail state. */
  perVenture: Record<string, number>;
  ventureNames: Record<string, string>;
  /** Read failures for finished work, in the attention queue's existing words. */
  errors: string[];
  /** Venture names whose sends could not be read. The count is then a floor, not a claim. */
  sendsUnread: string[];
  /** Venture names whose factory cards could not be read. The count is then a floor too. */
  cardsUnread: string[];
  /** The line saying the factory has gone quiet, so its cards may be out of date (FB-278). */
  cardsQuiet: string | null;
}

export async function loadAccessibleNeedsYou(
  email: string,
  opts: {
    refresh?: boolean;
    ticketsFor?: (venture: VentureSummary) => Promise<ReadonlyMap<string, readonly MatchableTicket[]> | undefined>;
    /** Reads a venture's sends. Defaults to the per-request shared read the desk and rail use. */
    approvalsFor?: (venture: VentureSummary) => Promise<ActiveGraphApproval[]>;
  } = {},
): Promise<AccessibleNeedsYou> {
  const ventures = loadVentures();
  const access = authorizeVentures(email, ventures, parseAdminEmails(process.env.STUDIO_ADMIN_EMAILS));
  // Scoping runs here, server-side, as it does in `loadAccessibleAttention` (non-negotiable 6).
  const visible = ventures.filter((v) => canAccessVenture(access, v.id));
  const readSends = opts.approvalsFor ?? ventureApprovals;

  const [attention, approvalsByVenture, cardsByVenture, factory] = await Promise.all([
    loadAccessibleAttention(email, { refresh: opts.refresh, ticketsFor: opts.ticketsFor }),
    Promise.all(
      visible.map((v) =>
        readSends(v).then(
          (a) => ({ venture: v, approvals: a, ok: true }),
          () => ({ venture: v, approvals: [] as ActiveGraphApproval[], ok: false }),
        ),
      ),
    ),
    // FB-277: each venture's cards, read only for the ventures this person passed the check for.
    Promise.all(visible.map((v) => ventureCardRows(v, viewerOf(email, v)).then((c) => ({ venture: v, ...c })))),
    // The factory's own cards: John's alone. `factoryCardsForJohn` checks that again itself.
    access.isAdmin ? factoryCardsForJohn(viewerOf(email, null)) : Promise.resolve({ rows: [] as CardRow[], unread: false, quiet: null }),
  ]);

  const sends: WaitingSend[] = [];
  const perVenture: Record<string, number> = {};
  const sendsUnread: string[] = [];
  const cardsUnread: string[] = [];
  const cards: CardRow[] = [];
  const work: PrApproval[] = [];
  for (const { venture, approvals, ok } of approvalsByVenture) {
    if (!ok) sendsUnread.push(venture.name);
    const own = cardsByVenture.find((c) => c.venture.id === venture.id) ?? { rows: [] as CardRow[], unread: false };
    if (own.unread) cardsUnread.push(venture.name);
    // One row per piece of work: the pull requests no card stands for, and the cards waiting.
    const open = withoutCarded(attention.approvals.filter((p) => p.ventureId === venture.id), own.rows);
    work.push(...open);
    cards.push(...own.rows.filter((r) => r.waits));
    perVenture[venture.id] = needsYouCount(open.length + cardsWaiting(own.rows), approvals);
    for (const a of sendsWaitingOnFounder(approvals)) {
      const row = sendRow(a, venture.id, sendSurface(venture.departments ?? [], a));
      sends.push({ ventureId: venture.id, row: row as WaitingSend['row'] });
    }
  }

  if (factory.unread) cardsUnread.push(FACTORY_NAME);
  if (access.isAdmin && cardsWaiting(factory.rows) > 0) {
    perVenture[FACTORY_VENTURE] = cardsWaiting(factory.rows);
    cards.push(...factory.rows.filter((r) => r.waits));
  }

  return {
    // Kept in the order the queue read them, oldest first.
    work: attention.approvals.filter((p) => work.includes(p)),
    cards,
    sends,
    count: Object.values(perVenture).reduce((n, c) => n + c, 0),
    perVenture,
    ventureNames: { ...attention.ventureNames, ...(access.isAdmin ? { [FACTORY_VENTURE]: FACTORY_NAME } : {}) },
    errors: attention.errors,
    sendsUnread,
    cardsUnread,
    // One planning box serves every venture, so any read that has cards says whether it is quiet.
    cardsQuiet: [...cardsByVenture, factory].find((c) => c.quiet)?.quiet ?? null,
  };
}
