import 'server-only';
import { cache } from 'react';
import { loadVentures, type VentureSummary } from './ventures';
import { approvalRepos } from './venture-repos';
import { cardStore } from './card-store-live';
import { parseAdminEmails } from './authz';
import {
  FACTORY_NAME, FACTORY_REPO, FACTORY_VENTURE, cardRows, namer,
  type CardRow, type LoadedCard, type Viewer,
} from './factory-work';
import { factoryQuietLine, isFactoryCard } from './press';
import { BUTTONS_OFF } from './presses';

/**
 * Reading the factory's cards for the lists a founder already has (FB-277). The rules for what a
 * card says are in `lib/factory-work.ts`; this only reads.
 *
 * **Call it only after the viewer has passed the venture check** (`canAccessVenture`, or
 * `requireVenture`), as every page here does before any read (CLAUDE.md #6). The read itself is
 * scoped too: the store reads inside the venture's own database scope (`withVenture`), so it cannot
 * return another venture's card whatever it is asked, and the cards are then kept to the venture's
 * own repositories, as the Review screen keeps them (`cardOf`, lib/review-load.ts).
 *
 * `_factory`, the factory's own cards, is read only for John: no manifest has that id, so no
 * founder's venture check can pass for it, and `factoryCardsForJohn` checks again.
 */

/** How many of a venture's newest cards a list reads. A list is bounded, as the page is. */
export const CARD_LIMIT = 50;

export interface VentureCards {
  cards: LoadedCard[];
  /** True when the store could not be read. The lists then say so rather than show nothing. */
  unread: boolean;
  /**
   * "The factory hasn't reported since 10:42. These may be out of date.", when there are cards and
   * the planning box has been quiet for five minutes (FB-278). Null otherwise.
   */
  quiet: string | null;
}

const NONE: VentureCards = { cards: [], unread: false, quiet: null };

/** The repositories a venture's cards may come from: its own, or cowgate for the factory. */
function reposOf(ventureId: string): string[] | null {
  if (ventureId === FACTORY_VENTURE) return [FACTORY_REPO];
  const venture = loadVentures().find((v) => v.id === ventureId);
  return venture ? approvalRepos(venture) : null;
}

/**
 * One venture's newest cards, with the presses on each, once per request.
 *
 * Keyed by id, not by the venture's object: the rail and the page each load the manifests fresh, so
 * two objects describe one venture, and React's `cache()` would miss (the FB-157 rule in
 * `lib/venture-reads.ts`).
 */
export const ventureCards = cache(async (ventureId: string): Promise<VentureCards> => {
  const store = cardStore();
  const repos = reposOf(ventureId);
  if (!store || !repos) return NONE;
  try {
    const got = await store.newest(ventureId, CARD_LIMIT);
    // The real clock, not `studioNow()`: the press times it is compared with are the real clock's.
    const readAt = Date.now();
    const cards = got.filter((c) => repos.includes(c.card.repo)).map((c) => ({ ventureId, readAt, ...c }));
    const quiet = cards.length ? await factoryQuietLine(store, readAt) : null;
    return { cards, unread: false, quiet };
  } catch (e) {
    console.error('[cards] could not read', { venture: ventureId, message: (e as Error)?.message });
    return { cards: [], unread: true, quiet: null };
  }
});

/** The viewer, as the card rules need them: whether they are John, and how to name who pressed. */
export function viewerOf(email: string, venture: Pick<VentureSummary, 'founderEmail' | 'founderName'> | null, env = process.env): Viewer {
  const admins = parseAdminEmails(env.STUDIO_ADMIN_EMAILS);
  return {
    isJohn: admins.map((a) => a.toLowerCase()).includes(email.toLowerCase()),
    name: namer(email, admins, { email: venture?.founderEmail ?? null, name: venture?.founderName ?? null }),
  };
}

/** One venture's cards as rows for this viewer, waiting ones first. */
export async function ventureCardRows(venture: VentureSummary, viewer: Viewer): Promise<{ rows: CardRow[]; cards: LoadedCard[]; unread: boolean; quiet: string | null }> {
  const read = await ventureCards(venture.id);
  return { rows: cardRows(read.cards, viewer, () => venture.name), cards: read.cards, unread: read.unread, quiet: read.quiet };
}

/**
 * The factory's own cards, cowgate's, for John's cross-venture pages. Nothing for anyone else: the
 * check is made here, again, so a page that forgot to make it still hands a founder nothing.
 */
export async function factoryCardsForJohn(viewer: Viewer): Promise<{ rows: CardRow[]; cards: LoadedCard[]; unread: boolean; quiet: string | null }> {
  if (!viewer.isJohn) return { rows: [], cards: [], unread: false, quiet: null };
  const read = await ventureCards(FACTORY_VENTURE);
  return { rows: cardRows(read.cards, viewer, () => FACTORY_NAME), cards: read.cards, unread: read.unread, quiet: read.quiet };
}

/**
 * Why the work page's buttons are off, when the work is a factory card and the planning box is quiet
 * (FB-278). Null for any other work, and while the box reports. The press is refused on the server
 * either way (`pressCard`); this is so the founder is told before pressing, not after.
 */
export async function workPageOff(venture: VentureSummary, repo: string, number: number): Promise<string | null> {
  const store = cardStore();
  try {
    if (!store || !(await isFactoryCard(store, venture, repo, number))) return null;
    const quiet = await factoryQuietLine(store, Date.now());
    return quiet ? `${quiet} ${BUTTONS_OFF}` : null;
  } catch (e) {
    console.error('[cards] could not read', { venture: venture.id, message: (e as Error)?.message });
    return null;
  }
}

/** The message a list shows when the cards could not be read. */
export const CARDS_UNREAD = 'The studio could not read some of your team’s finished work just now, so it may be missing here.';
